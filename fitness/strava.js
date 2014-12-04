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
module.exports = function(RED) {
    "use strict";
    // needed for auth
    var crypto = require("crypto");
    var Url = require('url');
    var request = require('request');
    
    function StravaCredentialsNode(n) {
        RED.nodes.createNode(this,n);
    }
    
    function StravaNode(n) {
        RED.nodes.createNode(this,n);
        
        var node = this;
        
        node.on("close", function() {
            node.inputType = null;
            node.outputType = null;
        });
    }
    
    RED.nodes.registerType("strava-credentials",StravaCredentialsNode, {
        credentials: {
            clientID: {type:"text"},
            clientSecret: {type: "password"},
            redirectURI: { type:"text"},
            access_token: {type: "password"}
        }
    });
    
    RED.nodes.registerType("strava",StravaNode);
    
    RED.httpAdmin.get('/strava-credentials/auth', function(req, res) {
        var node_id = req.query.node_id;
        
        var credentials = RED.nodes.getCredentials(node_id) || {};
        
        credentials.client_id = req.query.client_id;
        credentials.client_secret = req.query.client_secret;
        credentials.redirect_uri = req.query.redirect_uri;
        
        if (!credentials.client_id || !credentials.client_secret || ! credentials.redirect_uri) {
            return res.send('ERROR: Received query from UI without the needed credentials');
        }
        
        var csrfToken = crypto.randomBytes(18).toString('base64').replace(/\//g, '-').replace(/\+/g, '_');
        credentials.csrfToken = csrfToken;

        res.redirect(Url.format({
            protocol: 'https',
            hostname: 'www.strava.com',
            pathname: '/oauth/authorize/',
            query: {
                client_id: credentials.client_id,
                redirect_uri: credentials.redirect_uri,
                response_type: "code",
                state: node_id + ":" + credentials.csrfToken
            }
        }));

        RED.nodes.addCredentials(node_id,credentials);
    });
    
    RED.httpAdmin.get('/strava-credentials/auth/callback', function(req, res) {
        var state = req.query.state.split(":");
        var node_id = state[0];
        var csrfToken = state[1];
        
        var credentials = RED.nodes.getCredentials(node_id) || {};

        if (!credentials || !credentials.client_id || !credentials.client_secret || ! credentials.redirect_uri) {
            return res.send('ERROR: no credentials - should never happen');
        }
        
        if (csrfToken !== credentials.csrfToken) {
            return res.status(401).send('CSRF token mismatch, possible cross-site request forgery attempt.');
        }
        
        RED.nodes.deleteCredentials(node_id); // we don't want to keep the csrfToken
        // from now on, credentials are in memory only
        delete credentials.csrfToken;
        
        if(!req.query.code) {
            return res.status(400).send('The callback from Instagram did not contain a required code');
        }
        
        credentials.code = req.query.code;
        
        request.post({
            url: 'https://www.strava.com/oauth/token',
            json: true,
            form: {
                client_id: credentials.client_id,
                client_secret: credentials.client_secret,
                code: credentials.code
            },
        }, function(err, result, data) {
            console.log(data);
            console.log(result);
            res.send("<html><head></head><body>Successfully authorized with Strava. You can close this window now.</body></html>");
        });
    });
};
