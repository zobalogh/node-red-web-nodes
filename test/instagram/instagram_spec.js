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

var should = require("should");
var sinon = require('sinon');

var instagramNode = require("../../instagram/instagram.js");

var helper = require('../helper.js');
var nock = helper.nock;

var testInterval;

// TODO clear out actual user information from nocked data

describe('instagram nodes', function() {
    beforeEach(function(done) {
        if (testInterval !== null) {
            clearInterval(testInterval);
        }
        helper.startServer(done);
    });

    afterEach(function(done) {
        if (testInterval !== null) {
            clearInterval(testInterval);
        }
        try {
            helper.unload();
            helper.stopServer(done);
        } catch (e) {
            var errorMessage = "" + e;
            errorMessage.should.be.exactly("Error: Not running");
            done();
        }
    });
    
    describe('query node', function() {
        
        it('redirects the user to Instagram for authorization', function(done) {
            var clientID = 123456789;
            var clientSecret = 987654321;
            var redirectURI = 'http://localhost:1880/instagram-credentials/auth/callback';
            
            var querystring = require("querystring");
            var redirectURIQueryString = querystring.escape(redirectURI);
            
            console.log(redirectURIQueryString);
            
            var flow = [{id:"n1", type:"helper", wires:[["n2"]]},
                        {id:"n4", type:"instagram-credentials"},
                        {id:"n2", type:"instagram", instagram: "n4", wires:[["n3"]],"inputType":"like","outputType":"link"},
                        {id:"n3", type:"helper"}];
            helper.load(instagramNode, flow, function() {
                helper.request()
                .get('/instagram-credentials/auth?node_id=n2&client_id=' + clientID + '&client_secret=' + clientSecret + '&redirect_uri=' + redirectURI)
                .expect(302) // expect redirect
                .expect(function(res) {
                    // expect redirect with the right query
                    try {
                        res.headers.location.indexOf("https://api.instagram.com/oauth/authorize/?client_id=" + clientID + "&redirect_uri=" + redirectURIQueryString + "&response_type=code&state=").should.equal(0);   
                    } catch (err) {
                        done(err);
                    }
                   
                })
                .end(function(err, res) {
                    if (err) return done(err);
                    done();
                });
            });
        });
        
        if (nock) { // featues requiring HTTP communication/mocking // TODO check if all tests require nock here
            it('can do oauth dance', function(done) {
                var csrfToken; // required to get and process/pass on the token, otherwise OAuth fails
                
                var clientID = 123456789;
                var clientSecret = 987654321;
                var redirectURI = 'http://localhost:1880/instagram-credentials/auth/callback';
                var accessToken = 'AN_ACCESS_TOKEN';
                var sessionCode = 'SOME_CODE_FROM_INSTAGRAM';
                
                var querystring = require("querystring");
                var redirectURIQueryString = querystring.escape(redirectURI);
                
                var flow = [{id:"n1", type:"helper", wires:[["n2"]]},
                            {id:"n4", type:"instagram-credentials"},
                            {id:"n2", type:"instagram", instagram: "n4", wires:[["n3"]],"inputType":"like","outputType":"link"},
                            {id:"n3", type:"helper"}];
                var scope = nock('https://api.instagram.com')
                .post('/oauth/access_token', "client_id=" + clientID + "&client_secret=" + clientSecret + "&grant_type=authorization_code&redirect_uri=" + redirectURIQueryString + "&code=" + sessionCode)
                .reply(200, {"access_token":accessToken,"user":{"username":"UserJoe","bio":"","website":"","profile_picture":"http://profile.picture","full_name":"UserJoe","id":"anUserID"}})
                .get('/v1/users/self?access_token=' + accessToken)
                .reply(200, {"meta":{"code":200},"data":{"username":"UserJoe"}});
                helper.load(instagramNode, flow, function() {
                    helper.request()
                    .get('/instagram-credentials/auth?node_id=n2&client_id=' + clientID + '&client_secret=' + clientSecret + '&redirect_uri=' + redirectURI)
                    .expect(function(res) {
                        try {
                            csrfToken = res.headers.location.split("&state=n2%3A")[1];
                        } catch (err) {
                            done(err);
                        }
                       
                    })
                    .end(function(err, res) {
                        if (err) return done(err);
                        // now call the callback URI as if Instagram called it
                        helper.request()
                        .get('/instagram-credentials/auth/callback?code=' + sessionCode + '&state=n2:' + csrfToken)
                        .expect(function(res) {
                            try {
                                res.text.indexOf("Successfully authorized with Instagram").should.not.equal(-1); // should succeed
                            } catch (err) {
                                done(err);
                            }
                        })
                        .end(function(err, res) {
                            if (err) return done(err);
                            // now call the callback URI as if Instagram called it
                            done();
                        });
                    });
                });
            });
            
            it('handles a photo upload and init', function(done) {
                // need to fake the HTTP requests of the init sequence, then straight away the sequence of getting a second photo
                
                var photoURI = 'http://mytesturl.com/aPhotoStandard.jpg';
                
                var scope = nock('https://api.instagram.com')
               .get('/v1/users/self/media/recent?count=1&access_token=AN_ACCESS_TOKEN') // request to get the initial photos uploaded by the user
               .reply(200, {"pagination":{},"meta":{"code":200},"data":[{"attribution":null,"tags":[],"type":"image","id":"MY_OLD_MEDIA_ID"}]})
               .get('/v1/users/self/media/recent?min_id=MY_OLD_MEDIA_ID&access_token=AN_ACCESS_TOKEN')
               .reply(200, {"pagination":{},"meta":{"code":200},"data":[{"attribution":null,"tags":[],"type":"image","images":{"standard_resolution":{"url":photoURI,"width":640,"height":640}},"id":"A_NEW_PHOTO_ID"}]});

                helper.load(instagramNode, [{id:"instagramCredentials1", type:"instagram-credentials"},
                                            {id:"instagramNode1", type:"instagram", instagram: "instagramCredentials1","inputType":"photo","outputType":"link", wires:[["helperNode1"]]},
                                            {id:"helperNode1", type:"helper"}],
                                            {
                                                "instagramCredentials1" : { // pre-loaded credentials, no need to call OAuth
                                                    username: "UserJohn",
                                                    access_token: "AN_ACCESS_TOKEN",
                                                    cliend_id: "A_CLIENT_ID",
                                                    client_secret: "A_CLIENT_SECRET",
                                                    redirect_uri: "AN_URI",
                                                    code: "A_CODE"
                                                }
                                            }, function() {

                    var instagramNode1 = helper.getNode("instagramNode1");
                    var helperNode1 = helper.getNode("helperNode1");
                    
                    helperNode1.on("input", function(msg) {
                        try {
                            if (testInterval !== null) {
                                clearInterval(testInterval);
                            }
                            msg.payload.should.equal(photoURI);
                            done();
                        } catch(err) {
                            if (testInterval !== null) {
                                clearInterval(testInterval);
                            }
                            done(err);
                        }
                    });
                    
                    var testInterval = setInterval(function() { // self trigger
                        if(instagramNode1._events.input) {
                            instagramNode1.receive({payload:""});
                        }
                    }, 100);
                });
            });
            
            it('handles like with init', function(done) {
                
                var newPhotoURL = "http://new_liked_photo_standard.jpg";
                var oldID = "MY_OLD_MEDIA_ID";
                
                // need to fake the HTTP requests of the init sequence, then straight away the sequence of getting a second photo
                var scope = nock('https://api.instagram.com')
               .get('/v1/users/self/media/liked?count=1&access_token=AN_ACCESS_TOKEN')
               .reply(200, {"pagination":{},"meta":{"code":200},"data":[{"attribution":null,"tags":[],"type":"image","user_has_liked":true,"id":oldID}]})
               .get('/v1/users/self/media/liked?access_token=AN_ACCESS_TOKEN')
               .reply(200,{"pagination":{},"meta":{"code":200},"data":[{"attribution":null,"tags":[],"type":"image","images":{"standard_resolution":{"url":newPhotoURL}}}, {"attribution":null,"tags":[],"type":"image","id":oldID}]});

                helper.load(instagramNode, [{id:"instagramCredentials1", type:"instagram-credentials"},
                                            {id:"instagramNode1", type:"instagram", instagram: "instagramCredentials1","inputType":"like","outputType":"link", wires:[["helperNode1"]]},
                                            {id:"helperNode1", type:"helper"}],
                                            {
                                                "instagramCredentials1" : { // pre-loaded credentials, no need to call OAuth
                                                    username: "UserJohn",
                                                    access_token: "AN_ACCESS_TOKEN",
                                                    cliend_id: "A_CLIENT_ID",
                                                    client_secret: "A_CLIENT_SECRET",
                                                    redirect_uri: "AN_URI",
                                                    code: "A_CODE"
                                                }
                                            }, function() {

                    var instagramNode1 = helper.getNode("instagramNode1");
                    var helperNode1 = helper.getNode("helperNode1");
                    
                    helperNode1.on("input", function(msg) {
                        try {
                            if (testInterval !== null) {
                                clearInterval(testInterval);
                            }
                            msg.payload.should.equal(newPhotoURL);
                            done();
                        } catch(err) {
                            if (testInterval !== null) {
                                clearInterval(testInterval);
                            }
                            done(err);
                        }
                    });
                    
                    testInterval = setInterval(function() { // self trigger
                        if(instagramNode1._events.input) {
                            instagramNode1.receive({payload:""});
                        }
                    }, 100);
                });
            });
            
            it('manages to buffer an image', function(done) {
                var photo = '/photo.jpg';
                var apiURI = 'https://api.instagram.com';
                var photoURI = apiURI + photo;
                
                var replyText = "Hello World";
                
                var scope = nock('https://api.instagram.com')
               .get('/v1/users/self/media/recent?count=1&access_token=AN_ACCESS_TOKEN') // request to get the initial photos uploaded by the user
               .reply(200, {"pagination":{},"meta":{"code":200},"data":[{"attribution":null,"tags":[],"type":"image","id":"MY_OLD_MEDIA_ID"}]})
               .get('/v1/users/self/media/recent?min_id=MY_OLD_MEDIA_ID&access_token=AN_ACCESS_TOKEN')
               .reply(200, {"pagination":{},"meta":{"code":200},"data":[{"attribution":null,"tags":[],"type":"image","images":{"standard_resolution":{"url":photoURI,"width":640,"height":640}},"id":"A_NEW_PHOTO_ID"}]})
               .get(photo)
               .reply(200, replyText);
                
                helper.load(instagramNode, [{id:"instagramCredentials1", type:"instagram-credentials"},
                                            {id:"instagramNode1", type:"instagram", instagram: "instagramCredentials1","inputType":"photo","outputType":"file", wires:[["helperNode1"]]},
                                            {id:"helperNode1", type:"helper"}],
                                            {
                                                "instagramCredentials1" : { // pre-loaded credentials, no need to call OAuth
                                                    username: "UserJohn",
                                                    access_token: "AN_ACCESS_TOKEN",
                                                    cliend_id: "A_CLIENT_ID",
                                                    client_secret: "A_CLIENT_SECRET",
                                                    redirect_uri: "AN_URI",
                                                    code: "A_CODE"
                                                }
                                            }, function() {

                    var instagramNode1 = helper.getNode("instagramNode1");
                    var helperNode1 = helper.getNode("helperNode1");
                    
                    helperNode1.on("input", function(msg) {
                        try {
                            if (testInterval !== null) {
                                clearInterval(testInterval);
                            }
                            msg.payload.toString().should.equal(replyText);
                            done();
                        } catch(err) {
                            if (testInterval !== null) {
                                clearInterval(testInterval);
                            }
                            done(err);
                        }
                    });
                    
                    testInterval = setInterval(function() { // self trigger
                        if(instagramNode1._events.input) {
                            instagramNode1.receive({payload:""});
                        }
                    }, 100);
                });
            });
        }
    });
    
    describe('input node', function() {
        if(nock) {
            it('handles its own input event registration/deregistration', function(done) {
                var scope = nock('https://api.instagram.com')
               .get('/v1/users/self/media/liked?count=1&access_token=AN_ACCESS_TOKEN')
               .reply(200, {"pagination":{},"meta":{"code":200},"data":[{"attribution":null,"tags":[],"type":"image","user_has_liked":true,"id":"irrelevant"}]})
               .get('/v1/users/self/media/liked?access_token=AN_ACCESS_TOKEN')
               .reply(200,{"pagination":{},"meta":{"code":200},"data":[{"attribution":null,"tags":[],"type":"image","images":{"standard_resolution":{"url":"irrelevant"}}}, {"attribution":null,"tags":[],"type":"image","id":"irrelevant"}]});
                helper.load(instagramNode, [{id:"instagramCredentials1", type:"instagram-credentials"},
                                            {id:"instagramNode1", type:"instagram in", instagram: "instagramCredentials1","inputType":"like","outputType":"link", wires:[["helperNode1"]]},
                                            {id:"helperNode1", type:"helper"}],
                                            {
                                                "instagramCredentials1" : { // pre-loaded credentials, no need to call OAuth
                                                    username: "UserJohn",
                                                    access_token: "AN_ACCESS_TOKEN",
                                                    cliend_id: "A_CLIENT_ID",
                                                    client_secret: "A_CLIENT_SECRET",
                                                    redirect_uri: "AN_URI",
                                                    code: "A_CODE"
                                                }
                                            }, function() {

                    var instagramNode1 = helper.getNode("instagramNode1");
                    var helperNode1 = helper.getNode("helperNode1");
                    
                    helperNode1.on("input", function(msg) {

                    });
                    
                    testInterval = setInterval(function() {
                        if(instagramNode1._events.input) {
                            instagramNode1.interval._repeat.should.be.true; // ensure that the query interval is indeed set
                            helper.unload();
                            helper.stopServer();
                            clearInterval(testInterval);
                            testInterval = setInterval(function() {
                                if(instagramNode1.interval._repeat === false) {
                                    done(); // success, the automatic interval has been cleared
                                }
                            }, 100);
                        }
                    }, 100);
                });
                
            });   
        }
    });
});
