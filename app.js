'use strict';

const config = require('./config');
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');
const userData = require('./user');
const fbService = require('./fb-service/fb-service');
const weatherService = require('./weather-service');
const jobApplicationCreate = require('./job-application-service');
let sendToApiAi = require('./apiai-service/sendToApiAi')

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
	throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
	throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('missing SERVER_URL');
}
if (!config.SENGRID_API_KEY) { //sending email
	throw new Error('missing SENGRID_API_KEY');
}
if (!config.EMAIL_FROM) { //sending email
	throw new Error('missing EMAIL_FROM');
}
if (!config.EMAIL_TO) { //sending email
	throw new Error('missing EMAIL_TO');
}
if (!config.WEATHER_API_KEY) { //weather api key
	throw new Error('missing WEATHER_API_KEY');
}


app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
	verify: fbService.verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}))

// Process application/json
app.use(bodyParser.json())


var pg = require('pg');
pg.defaults.ssl = true;




const sessionIds = new Map();
const usersMap = new Map();
// Index route
app.get('/', function (req, res) {
	res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));


	// Make sure this is a page subscription
	if (data.object == 'page') {

		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.optin) {
					fbService.receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.delivery) {
					fbService.receivedDeliveryConfirmation(messagingEvent);
				} else if (messagingEvent.postback) {
					receivedPostback(messagingEvent);
				} else if (messagingEvent.read) {
					fbService.receivedMessageRead(messagingEvent);
				} else if (messagingEvent.account_linking) {
					fbService.receivedAccountLink(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		// You must send back a 200, within 20 seconds
		res.sendStatus(200);
	}
});


function setSessionAndUser(senderID) {
	if (!sessionIds.has(senderID)) {
		sessionIds.set(senderID, uuid.v1());
	}
	if (!usersMap.has(senderID)) {
		userData(function(user){
			usersMap.set(senderID, user);
		}, senderID);
	}
}


function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	setSessionAndUser(senderID);

	//console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	//console.log(JSON.stringify(message));


	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
		fbService.handleEcho(messageId, appId, metadata);
		return;
	} else if (quickReply) {
		handleQuickReply(senderID, quickReply, messageId);
		return;
	}


	if (messageText) {
		//send message to api.ai
		sendToApiAi(sessionIds, handleApiAiResponse, senderID, messageText);
	} else if (messageAttachments) {
		fbService.handleMessageAttachments(messageAttachments, senderID);
	}
}


function handleQuickReply(senderID, quickReply, messageId) {
	var quickReplyPayload = quickReply.payload;
	console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
	//send payload to api.ai
	sendToApiAi(sessionIds, handleApiAiResponse, senderID, quickReplyPayload);
}



function handleApiAiAction(sender, action, responseText, contexts, parameters) {
	switch (action) {
		case "get-current-weather":
			if (parameters.hasOwnProperty("geo-city") && parameters["geo-city"]!='') {

				weatherService(function(weatherResponse){
					if (!weatherResponse) {
						fbService.sendTextMessage(sender,
							`No weather forecast available for ${parameters["geo-city"]}`);
					} else {
						let reply = `${responseText} ${weather["weather"][0]["description"]}`;
						fbService.sendTextMessage(sender, reply);
					}


				}, parameters["geo-city"]);

				let reply = `${responseText} `;
			} else {
				fbService.sendTextMessage(sender, responseText);
			}
			break;
		case "faq-delivery":
			fbService.sendTextMessage(sender, responseText);
			fbService.sendTypingOn(sender);

			//ask what user wants to do next
			setTimeout(function() {
				let buttons = [
					{
						type:"web_url",
						url:"https://www.myapple.com/track_order",
						title:"Track my order"
					},
					{
						type:"phone_number",
						title:"Call us",
						payload:"+16505551234",
					},
					{
						type:"postback",
						title:"Keep on Chatting",
						payload:"CHAT"
					}
				];

				fbService.sendButtonMessage(sender, "What would you like to do next?", buttons);
			}, 3000)

			break;
		case "detailed-application":
			if (isDefined(contexts[0]) &&
				(contexts[0].name == 'job_application' || contexts[0].name == 'job-application-details_dialog_context')
				&& contexts[0].parameters) {
				let phone_number = (isDefined(contexts[0].parameters['phone-number'])
				&& contexts[0].parameters['phone-number']!= '') ? contexts[0].parameters['phone-number'] : '';
				let user_name = (isDefined(contexts[0].parameters['user-name'])
				&& contexts[0].parameters['user-name']!= '') ? contexts[0].parameters['user-name'] : '';
				let previous_job = (isDefined(contexts[0].parameters['previous-job'])
				&& contexts[0].parameters['previous-job']!= '') ? contexts[0].parameters['previous-job'] : '';
				let years_of_experience = (isDefined(contexts[0].parameters['years-of-experience'])
				&& contexts[0].parameters['years-of-experience']!= '') ? contexts[0].parameters['years-of-experience'] : '';
				let job_vacancy = (isDefined(contexts[0].parameters['job-vacancy'])
				&& contexts[0].parameters['job-vacancy']!= '') ? contexts[0].parameters['job-vacancy'] : '';


				if (phone_number == '' && user_name != '' && previous_job != '' && years_of_experience == '') {

					let replies = [
						{
							"content_type":"text",
							"title":"Less than 1 year",
							"payload":"Less than 1 year"
						},
						{
							"content_type":"text",
							"title":"Less than 10 years",
							"payload":"Less than 10 years"
						},
						{
							"content_type":"text",
							"title":"More than 10 years",
							"payload":"More than 10 years"
						}
					];
					fbService.sendQuickReply(sender, responseText, replies);
				} else if (phone_number != '' && user_name != '' && previous_job != '' && years_of_experience != ''
					&& job_vacancy != '') {
					jobApplicationCreate(phone_number, user_name, previous_job, years_of_experience, job_vacancy);
					fbService.sendTextMessage(sender, responseText);
				} else {
					fbService.sendTextMessage(sender, responseText);
				}
			}
			break;
		case "job-enquiry":
			let replies = [
				{
					"content_type":"text",
					"title":"Accountant",
					"payload":"Accountant"
				},
				{
					"content_type":"text",
					"title":"Sales",
					"payload":"Sales"
				},
				{
					"content_type":"text",
					"title":"Not interested",
					"payload":"Not interested"
				}
			];
			fbService.sendQuickReply(sender, responseText, replies);
			break;
		default:
			//unhandled action, just send back the text
			//console.log("send responce in handle actiongit: " + responseText);
			fbService.sendTextMessage(sender, responseText);
	}
}



function handleApiAiResponse(sender, response) {

	let responseText = response.result.fulfillment.speech;
	let responseData = response.result.fulfillment.data;
	let messages = response.result.fulfillment.messages;
	let action = response.result.action;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;

	fbService.sendTypingOff(sender);

	if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1)) {
		let timeoutInterval = 1100;
		let previousType ;
		let cardTypes = [];
		let timeout = 0;
		for (var i = 0; i < messages.length; i++) {

			if ( previousType == 1 && (messages[i].type != 1 || i == messages.length - 1)) {

				timeout = (i - 1) * timeoutInterval;
				setTimeout(fbService.handleCardMessages.bind(null, cardTypes, sender), timeout);
				cardTypes = [];
				timeout = i * timeoutInterval;
				setTimeout(fbService.handleMessage.bind(null, messages[i], sender), timeout);
			} else if ( messages[i].type == 1 ) {
				cardTypes.push(messages[i]);
			} else {
				timeout = i * timeoutInterval;
				setTimeout(fbService.handleMessage.bind(null, messages[i], sender), timeout);
			}

			previousType = messages[i].type;

		}
	} else if (responseText == '' && !isDefined(action)) {
		//api ai could not evaluate input.
		//console.log('Unknown query' + response.result.resolvedQuery);
		fbService.sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
	} else if (isDefined(action)) {
		handleApiAiAction(sender, action, responseText, contexts, parameters);
	} else if (isDefined(responseData) && isDefined(responseData.facebook)) {
		try {
			fbService.sendTextMessage(sender, responseData.facebook);
		} catch (err) {
			fbService.sendTextMessage(sender, err.message);
		}
	} else if (isDefined(responseText)) {
		fbService.sendTextMessage(sender, responseText);
	}
}




function greetUserText(userId) {
	let user = usersMap.get(userId);
	fbService.sendTextMessage(userId, "Welcome " + user.first_name + '! ' +
		'I can answer frequently asked questions for you ' +
		'and I perform job interviews. What can I help you with?');

}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfPostback = event.timestamp;

	// The 'payload' param is a developer-defined field which is set in a postback
	// button for Structured Messages.
	var payload = event.postback.payload;

	setSessionAndUser(senderID);

	switch (payload) {
		case 'GET_STARTED':
			greetUserText(senderID);
			break;
		case 'JOB_APPLY':
			//get feedback with new jobs
			sendToApiAi(sessionIds, handleApiAiResponse, senderID, "job openings");
			break;
		case 'CHAT':
			//user wants to chat
			fbService.sendTextMessage(senderID, "I love chatting too. Do you have any other questions for me?");
			break;
		default:
			//unindentified payload
			fbService.sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
			break;

	}

	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

}



function isDefined(obj) {
	if (typeof obj == 'undefined') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
	console.log('running on port', app.get('port'))
})
