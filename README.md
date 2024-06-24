strfry-push-notify
==================

This is a [soapbox-strfry-policies](https://gitlab.com/soapbox-pub/strfry-policies/-/tree/develop)-based plugin for [strfry](https://github.com/hoytech/strfry) that sends APNS (Apple Push Notification Service) notifications

**⚠️  This is still under active development, testing, and experimentation**

## Installation

1. Install [strfry](https://github.com/hoytech/strfry)
2. Install [soapbox-strfry-policies](https://gitlab.com/soapbox-pub/strfry-policies/-/tree/develop)
3. Clone this repository
4. Initialize a new sender policy using `makeNotificationSenderPolicy` and add it to your `strfry-policy.ts`. Example:

```diff
import {
  antiDuplicationPolicy,
  hellthreadPolicy,
  pipeline,
  rateLimitPolicy,
  readStdin,
  writeStdout,
} from 'https://gitlab.com/soapbox-pub/strfry-policies/-/raw/433459d8084d1f2d6500fdf916f22caa3b4d7be5/mod.ts';
+ import makeNotificationSenderPolicy from "../notificationSenderPolicy.ts";

+ const notificationSenderPolicy = await makeNotificationSenderPolicy();

for await (const msg of readStdin()) {
  const result = await pipeline(msg, [
    [hellthreadPolicy, { limit: 100 }],
    [antiDuplicationPolicy, { ttl: 60000, minLength: 50 }],
+    [notificationSenderPolicy, { rejectEvents: false }],
    [rateLimitPolicy, { whitelist: ['127.0.0.1'] }],
  ]);

  writeStdout(result);
}
```

5. Go to the root of this repository and run `npm install` to install the node modules for the node.js script that will be used to send the notifications

6. On the working directory from which you start `strfry`, create an `.env` file with the following contents:

```env
APNS_TOPIC="com.your_org.your_app"        # Your app's bundle ID
APNS_AUTH_PRIVATE_KEY_FILE_PATH=./AuthKey_1234567890.p8	# Path to the private key file used to generate JWT tokens with the Apple APNS server. You can obtain this from https://developer.apple.com/account/resources/authkeys/list
APNS_AUTH_PRIVATE_KEY_ID=1234567890 # The ID of the private key used to generate JWT tokens with the Apple APNS server. You can obtain this from https://developer.apple.com/account/resources/authkeys/list
APNS_ENVIRONMENT="development"    # The environment to use with the APNS server. Can be "development" or "production"
APPLE_TEAM_ID=1248163264        # The ID of the team. Can be found in AppStore Connect.
DB_PATH=./apns_notifications.db         # Path to the SQLite database file that will be used to store data about sent notifications, relative to the working directory
RELAY_URL=ws://localhost:7777           # URL to the relay server which will be consulted to get information such as mute lists.
API_BASE_URL=http://localhost:8000      # Base URL from the API is allowed access (used by the server to perform NIP-98 authentication)
```

6. Start strfry
7. Start the device token receiver using:

```sh
/path/to/where/you/start/strfry $ deno run --allow-read --allow-write --allow-net --allow-env /path/to/strfry-push-notify/src/notificationServiceServer.ts
```

## Contributions

For contribution guidelines, please check [this](https://github.com/damus-io/damus/blob/master/docs/CONTRIBUTING.md) document.

## Development setup

A Linux VM or a Linux machine is recommended for development.

1. Install [strfry](https://github.com/hoytech/strfry)
2. Install [soapbox-strfry-policies](https://gitlab.com/soapbox-pub/strfry-policies/-/tree/develop)
3. Clone this repository
4. Set the strfry policy to our test example policy at `src/testUtils/strfry-policy.ts`
5. Get a `.p8` **development** private key from [AppStore Connect](https://developer.apple.com/account/resources/authkeys/list) and save it where you start your strfry instance. This key will be used to generate JWT tokens for the APNS server.
6. Install the node modules for the node.js script that will be used to send the notifications:

```sh
$ npm install
```

6. On the working directory from which you start `strfry`, create an `.env` file with the following contents (assuming you're using the mock APNS server):

```env
APNS_TOPIC="com.your_org.your_app"        # Your app's bundle ID
APNS_AUTH_PRIVATE_KEY_FILE_PATH=./AuthKey_1234567890.p8	# Path to the private key file used to generate JWT tokens with the Apple APNS server. You can obtain this from https://developer.apple.com/account/resources/authkeys/list
APNS_AUTH_PRIVATE_KEY_ID=1234567890 # The ID of the private key used to generate JWT tokens with the Apple APNS server. You can obtain this from https://developer.apple.com/account/resources/authkeys/list
APNS_ENVIRONMENT="development"    # The environment to use with the APNS server. Can be "development" or "production"
APPLE_TEAM_ID=1248163264        # The ID of the team. Can be found in AppStore Connect.
DB_PATH=./apns_notifications.db         # Path to the SQLite database file that will be used to store data about sent notifications, relative to the working directory
RELAY_URL=ws://localhost:7777           # URL to the relay server which will be consulted to get information such as mute lists.
API_BASE_URL=http://localhost:8000      # Base URL from the API is allowed access (used by the server to perform NIP-98 authentication).
```

6. Start strfry
7. Start the device token receiver using:

```sh
$ deno run --allow-read --allow-write --allow-net /path/to/strfry-push-notify/src/notificationServiceServer.ts
```
