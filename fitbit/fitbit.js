/**
 * Copyright 2014 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

/*
  var nock = require('nock');
  nock.recorder.rec({
  dont_print: false,
  output_objects: true,
  enable_reqheaders_recording: true
  });
  ...
  console.log(require('util').inspect(nock.recorder.play()));
  */

module.exports = function(RED) {
    "use strict";
    var OAuth= require('oauth').OAuth;
    var util = require("util");

    function getOAuth(client_key, client_secret) {
        return new OAuth(
            "https://api.fitbit.com/oauth/request_token",
            "https://api.fitbit.com/oauth/access_token",
            client_key,
            client_secret,
            1.0,
            null,
            "HMAC-SHA1"
        );
    }

    function FitbitNode(n) {
        RED.nodes.createNode(this,n);
        this.username = n.username;
    }
    RED.nodes.registerType("fitbit-credentials",FitbitNode,{
        credentials: {
            username: {type:"text"},
            client_key: { type: "password"},
            client_secret: { type: "password"},
            access_token: {type: "password"},
            access_token_secret: {type:"password"}
        }
    });
    function today() {
        var d = new Date();
        var month = d.getMonth() + 1;
        var day = d.getDate();
        return d.getFullYear() + "-" +
            (month < 10 ? "0" : "") + month + "-" +
            (day < 10 ? "0" : "") + day;
    }

    function FitbitQueryNode(n) {
        RED.nodes.createNode(this,n);
        this.fitbitConfig = RED.nodes.getNode(n.fitbit);
        this.dataType = n.dataType || 'activities';
        if (!this.fitbitConfig) {
            this.warn("Missing fitbit credentials");
            return;
        }
        var credentials = this.fitbitConfig.credentials;
        if (credentials &&
            credentials.access_token && credentials.access_token_secret) {
            var oa = getOAuth(credentials.client_key,credentials.client_secret);
            var node = this;
            this.on('input', function(msg) {
                node.status({fill:"blue",shape:"dot",text:"querying"});
                var url;
                if (node.dataType === 'activities' ||
                    node.dataType === 'sleep') {
                    var day = msg.date || today();
                    url = 'https://api.fitbit.com/1/user/-/' +
                        node.dataType + '/date/' + day + '.json';
                } else if (node.dataType === 'badges') {
                    url = 'https://api.fitbit.com/1/user/-/badges.json';
                } else {
                    node.status({fill:"red",shape:"ring",text:"invalid type"});
                    return;
                }
                oa.get(url,
                       credentials.access_token,
                       credentials.access_token_secret,
                       function(err, body, response) {
                    if (err) {
                        console.log(util.inspect(err));
                        node.error("Error: " + err);
                        node.status({fill:"red",shape:"ring",text:"failed"});
                        return;
                    }
                    var data = JSON.parse(body);
                    node.status({});
                    msg.payload = data;
                    node.send(msg);
                });
            });
        }
    }
    RED.nodes.registerType("fitbit",FitbitQueryNode);


    RED.httpAdmin.get('/fitbit-credentials/:id/auth', function(req, res){
        if (!req.query.client_key || !req.query.client_secret ||
            !req.query.callback) {
            res.send(400);
            return;
        }

        var credentials = {
            client_key:req.query.client_key,
            client_secret: req.query.client_secret
        };
        RED.nodes.addCredentials(req.params.id, credentials);

        var oa = getOAuth(credentials.client_key, credentials.client_secret);

        oa.getOAuthRequestToken({
            oauth_callback: req.query.callback
        }, function(error, oauth_token, oauth_token_secret, results) {
            if (error) {
                res.send('<h2>Oh no!</h2>'+
                '<p>Something went wrong with the authentication process. The following error was returned:<p>'+
                '<p><b>'+error.statusCode+'</b>: '+error.data+'</p>'+
                '<p>One known cause of this type of failure is if the clock is wrong on system running Node-RED.</p>');
            } else {
                credentials.oauth_token = oauth_token;
                credentials.oauth_token_secret = oauth_token_secret;
                res.redirect('https://www.fitbit.com/oauth/authorize?oauth_token='+oauth_token);
                RED.nodes.addCredentials(req.params.id,credentials);
            }
        });
    });

    RED.httpAdmin.get('/fitbit-credentials/:id/auth/callback', function(req, res, next){
        var credentials = RED.nodes.getCredentials(req.params.id);
        credentials.oauth_verifier = req.query.oauth_verifier;
        var client_key = credentials.client_key;
        var client_secret = credentials.client_secret;
        var oa = getOAuth(client_key,client_secret);

        oa.getOAuthAccessToken(
            credentials.oauth_token,
            credentials.oauth_token_secret,
            credentials.oauth_verifier,
            function(error, oauth_access_token, oauth_access_token_secret, results){
                if (error){
                    res.send('<h2>Oh no!</h2>'+
                             '<p>Something went wrong with the authentication process. The following error was returned:<p>'+
                             '<p><b>'+error.statusCode+'</b>: '+error.data+'</p>'+
                             '<p>One known cause of this type of failure is if the clock is wrong on system running Node-RED.</p>');
                } else {
                    credentials = {};
                    credentials.client_key = client_key;
                    credentials.client_secret = client_secret;
                    credentials.access_token = oauth_access_token;
                    credentials.access_token_secret = oauth_access_token_secret;
                    oa.get('https://api.fitbit.com/1/user/-/profile.json', credentials.access_token, credentials.access_token_secret, function(err, body, response) {
                          if (err) {
                            return res.send('<h2>Oh no!</h2>'+
                             '<p>Something went wrong fetching the user profile. The following error was returned:<p>'+
                             '<p><b>'+err.statusCode+'</b>: '+err.data+'</p>'+
                             '<p>One known cause of this type of failure is if the clock is wrong on system running Node-RED.</p>');
                        }
                        var data = JSON.parse(body);
                        credentials.username = data.user.fullName;
                        RED.nodes.addCredentials(req.params.id,credentials);
                        res.send("<html><head></head><body>Authorised - you can close this window and return to Node-RED</body></html>");
                    });
                }
            }
        );
    });
}
