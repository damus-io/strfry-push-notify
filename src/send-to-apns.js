const express = require('express');
const app = express();
const port = 8990;
const dotenv = require('dotenv');
const { ApnsClient, Notification } = require('apns2');
const fs = require('fs');

let result = dotenv.config();

const APNS_AUTH_PRIVATE_KEY_FILE_PATH = process.env.APNS_AUTH_PRIVATE_KEY_FILE_PATH;
const APNS_TOPIC = process.env.APNS_TOPIC;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const APNS_AUTH_PRIVATE_KEY_ID = process.env.APNS_AUTH_PRIVATE_KEY_ID;
const APNS_ENVIRONMENT = process.env.APNS_ENVIRONMENT;

const apn = new ApnsClient({
    team: APPLE_TEAM_ID,
    keyId: APNS_AUTH_PRIVATE_KEY_ID,
    signingKey: fs.readFileSync(APNS_AUTH_PRIVATE_KEY_FILE_PATH),
    defaultTopic: APNS_TOPIC,
    host: APNS_ENVIRONMENT === "production" ? "api.push.apple.com" : "api.development.push.apple.com",
});

let data = '';
process.stdin.on('data', function(chunk) {
    data += chunk;
});

process.stdin.on('end', function () {
  const payload = JSON.parse(data);

  const deviceToken = payload.deviceToken;
  const title = payload.title;
  const subtitle = payload.subtitle;
  const body = payload.body;
  const event = payload.event;

  const notification = new Notification(deviceToken, {
    aps: {
      alert: {
        title: title,
        subtitle: subtitle,
        body: body,
      },
      "mutable-content": 1
    },
    data: {
      "nostr_event": JSON.stringify(event),
    }
  });

  apn.send(notification).then((response) => {
    console.log("Notification sent to device token", deviceToken, "with response", response);
    process.stdout.write(JSON.stringify({ status: 'Sent', response: response }));
    process.exit(0);
  }).catch((error) => {
    console.error("Error sending notification to device token", deviceToken, "with error", error);
    process.stdout.write(JSON.stringify({ status: 'Error', error: error }));
    process.exit(1);
  });
});
