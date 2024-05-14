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

5. On the working directory from which you start `strfry`, create an `.env` file with the following contents:

```env
APNS_SERVER_BASE_URL=https://api.push.apple.com/3/device/
APNS_AUTH_METHOD="certificate"      # or "token"
APNS_AUTH_TOKEN=<your_token_here>   # Only if APNS_AUTH_METHOD is "token"
APNS_TOPIC="com.jb55.damus2"        # Your app's bundle ID
APNS_CERTIFICATE_FILE_PATH=./apns_cert.pem      # Only if APNS_AUTH_METHOD is "certificate". Path to your APNS certificate file
APNS_CERTIFICATE_KEY_FILE_PATH=./apns_key.pem   # Only if APNS_AUTH_METHOD is "certificate". Path to your APNS certificate key file
DB_PATH=./apns_notifications.db     # Path to the SQLite database file that will be used to store data about sent notifications
RELAY_URL=ws://localhost            # URL to the relay server which will be consulted to get information such as mute lists.
```

6. Start strfry
7. Start the device token receiver using:

```sh
$ deno run --allow-read --allow-write --allow-net /path/to/strfry-push-notify/src/notificationServiceServer.ts
```

## Contributions

For contribution guidelines, please check [this](https://github.com/damus-io/damus/blob/master/docs/CONTRIBUTING.md) document.

## Development setup

A Linux VM or a Linux machine is recommended for development.

1. Install [strfry](https://github.com/hoytech/strfry)
2. Install [soapbox-strfry-policies](https://gitlab.com/soapbox-pub/strfry-policies/-/tree/develop)
3. Clone this repository
4. Set the strfry policy to our test example policy at `src/testUtils/strfry-policy.ts`
5. Start up the mock APNS server (if authentication with real APNS is not feasible/needed in your environment) using:

```sh
$ deno run --allow-net /path/to/strfry-push-notify/src/mockAPNSServer.ts
```

5. On the working directory from which you start `strfry`, create an `.env` file with the following contents (assuming you're using the mock APNS server):

```env
APNS_SERVER_BASE_URL=http://localhost:8001/push-notification
APNS_AUTH_METHOD="token"
APNS_AUTH_TOKEN=""                  # Can be anything if using the mock APNS server
APNS_TOPIC="com.jb55.damus2"        # Your app's bundle ID
DB_PATH=./apns_notifications.db     # Path to the SQLite database file that will be used to store data about sent notifications
RELAY_URL=ws://localhost:7777       # URL to the relay server which will be consulted to get information such as mute lists.
```

6. Start strfry
7. Start the device token receiver using:

```sh
$ deno run --allow-read --allow-write --allow-net /path/to/strfry-push-notify/src/notificationServiceServer.ts
```