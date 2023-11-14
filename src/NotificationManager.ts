import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";
import { Pubkey } from "./types.ts";
import { NostrEvent } from "./NostrEvent.ts";
import { load } from "https://deno.land/std@0.205.0/dotenv/mod.ts";
import https from "node:https";
import fs from "node:fs";

const env = await load();
const APNS_SERVER_BASE_URL = env["APNS_SERVER_BASE_URL"] || "http://localhost:8001/push-notification/"; // Probably api.development.push.apple.com/3/device for development, api.push.apple.com/3/device for production
const APNS_AUTH_METHOD: "certificate" | "token" = env["APNS_AUTH_METHOD"] as ("certificate" | "token") || "token";
const APNS_AUTH_TOKEN = env["APNS_AUTH_TOKEN"];
const APNS_TOPIC = env["APNS_TOPIC"] || "com.jb55.damus2";
const APNS_CERTIFICATE_FILE_PATH = env["APNS_CERTIFICATE_FILE_PATH"] || "./apns_cert.pem";
const APNS_CERTIFICATE_KEY_FILE_PATH = env["APNS_CERTIFICATE_KEY_FILE_PATH"] || "./apns_key.pem";

// The NotificationManager has three main responsibilities:
// 1. Keep track of pubkeys and associated iOS device tokens
// 2. Keep track of which pubkeys have received notifications for each event, so that we don't send duplicate notifications
// 3. Send notifications to the relevant iOS devices when a new event is received
export class NotificationManager {
    private dbPath: string;
    private db: DB;
    private isDatabaseSetup: boolean;

    constructor(dbPath?: string | undefined) {
        this.dbPath = dbPath || "./apns_notifications.db"
        this.db = new DB(this.dbPath);
        this.isDatabaseSetup = false;
    }

    async setupDatabase() {
        // Create a table of notification statuses for each event
        await this.db.execute('CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, event_id TEXT, pubkey TEXT, received_notification BOOLEAN)');
        // Create an index on the event_id column for faster lookups
        await this.db.execute('CREATE INDEX IF NOT EXISTS notification_event_id_index ON notifications (event_id)');
        // Create a table of device tokens and associated pubkeys
        await this.db.execute('CREATE TABLE IF NOT EXISTS user_info (id TEXT PRIMARY KEY, device_token TEXT, pubkey TEXT)');
        // Create an index on the pubkey column for faster lookups
        await this.db.execute('CREATE INDEX IF NOT EXISTS user_info_pubkey_index ON user_info (pubkey)');
        this.isDatabaseSetup = true;
    };

    throwIfDatabaseNotSetup() {
        if (!this.isDatabaseSetup) {
            throw new Error("Database not setup. Run setupDatabase() first.");
        }
    }

    async sendNotificationsIfNeeded(event: NostrEvent) {
        this.throwIfDatabaseNotSetup();
    
        // 1. Determine which pubkeys to notify
        const notificationStatusForThisEvent: NotificationStatus = await this.getNotificationStatus(event);
        const relevantPubkeys: Set<Pubkey> = await this.pubkeysRelevantToEvent(event);
        const pubkeysThatReceivedNotification = notificationStatusForThisEvent.pubkeysThatReceivedNotification();
        const pubkeysToNotify = new Set<Pubkey>(
            [...relevantPubkeys].filter(x => !pubkeysThatReceivedNotification.has(x) && x !== event.info.pubkey)
        );
        
        // 2. Send the notifications to them
        for(const pubkey of pubkeysToNotify) {
            await this.sendEventNotificationsToPubkey(event, pubkey);
        }
    
        // 3. Record who we sent notifications to
        await this.db.query('INSERT OR REPLACE INTO notifications (id, event_id, pubkey, received_notification) VALUES (?, ?, ?, ?)', [event.info.id + ":" + event.info.pubkey, event.info.id, event.info.pubkey, true]);
    };

    async pubkeysRelevantToEvent(event: NostrEvent): Promise<Set<Pubkey>> {
        await this.throwIfDatabaseNotSetup();
        const relevantPubkeys: Set<Pubkey> = event.relevantPubkeys();
        const referencedEventIds: Set<string> = event.referencedEventIds();
        const pubkeysInThread: Set<Pubkey> = new Set<Pubkey>();
        for(const referencedEventId of referencedEventIds) {
            const pubkeysRelevantToReferencedEvent = await this.pubkeysSubscribedToEventId(referencedEventId);
            pubkeysRelevantToReferencedEvent.forEach((pubkey: Pubkey) => {
                pubkeysInThread.add(pubkey);
            });
        }
        return new Set<Pubkey>([...relevantPubkeys, ...pubkeysInThread]);
    }

    async pubkeysSubscribedToEvent(event: NostrEvent): Promise<Set<Pubkey>> {
        return await this.pubkeysSubscribedToEventId(event.info.id);
    }

    async pubkeysSubscribedToEventId(eventId: string): Promise<Set<Pubkey>> {
        await this.throwIfDatabaseNotSetup();
        const resultRows: Array<[string]> = await this.db.query('SELECT pubkey FROM notifications WHERE event_id = (?)', [eventId]);
        return new Set<Pubkey>(resultRows.map(([pubkey]) => { return pubkey }));
    }

    async sendEventNotificationsToPubkey(event: NostrEvent, pubkey: Pubkey) {
        const userDeviceTokens = await this.getUserDeviceTokens(pubkey);
    
        // Send the notification to each device token
        for(const deviceToken of userDeviceTokens) {
            await this.sendEventNotificationToDeviceToken(event, deviceToken);
        }
    };

    async getUserDeviceTokens(pubkey: Pubkey): Promise<Array<string>> {
        this.throwIfDatabaseNotSetup();

        // Get the device tokens for this pubkey
        const resultRows: Array<[string]> = await this.db.query('SELECT device_token FROM user_info WHERE pubkey = (?)', [pubkey]);
    
        if (resultRows.length === 0) {
            // No device tokens found for this pubkey
            return [];
            
        } else {
            return resultRows.map(([deviceToken]) => { return deviceToken });
        }
    }

    async getNotificationStatus(event: NostrEvent): Promise<NotificationStatus> {
        this.throwIfDatabaseNotSetup();

        // Get the notification status for this event
        const resultRows: Array<[string, boolean]> = await this.db.query('SELECT pubkey, received_notification FROM notifications WHERE event_id = (?)', [event.info.id]);
    
        if (resultRows.length === 0) {
            // No notification status found for this event, create an empty status object
            return new NotificationStatus({});
        } else {
            const notificationStatusInfo: Record<Pubkey, boolean> = Object.fromEntries(resultRows);
            return new NotificationStatus(notificationStatusInfo);
        }
    }

    async sendEventNotificationToDeviceToken(event: NostrEvent, deviceToken: string) {
        const { title, subtitle, body } = this.formatNotificationMessage(event);

        if (APNS_AUTH_METHOD === "certificate") {
            // Send using certificate-based authentication
            const options = {
                hostname: APNS_SERVER_BASE_URL,
                port: 443,
                path: deviceToken,
                method: 'POST',
                cert: fs.readFileSync(APNS_CERTIFICATE_FILE_PATH),
                key: fs.readFileSync(APNS_CERTIFICATE_KEY_FILE_PATH),
                headers: {
                  "apns-topic": APNS_TOPIC,
                  "apns-push-type": "alert",
                  "apns-priority": "5",
                  "apns-expiration": "0"
                }
            };

            https.request(options, (res) => {
                // No need to do anything here yet
            })
            return;
        }

        await fetch(APNS_SERVER_BASE_URL + deviceToken, {
            method: 'POST',
            headers: {
                'authorization': `bearer ${APNS_AUTH_TOKEN}`,
                'apns-topic': APNS_TOPIC,
                'apns-push-type': 'alert',  // Important to allow notifications to be optionally suppressed (e.g. when the app already delivered a local notification)
                'apns-priority': '5',
                'apns-expiration': '0',
            },
            body: JSON.stringify({
                aps: {
                    alert: {
                        title: title,
                        subtitle: subtitle,
                        body: body,
                    },
                    "mutable-content": 1
                },
                nostr_event: event.info,
            }),
        });
    }

    formatNotificationMessage(event: NostrEvent): { title: string, subtitle: string, body: string } {
        // This is a very basic notification format. 
        // The idea is that the app will do the heavy lifting of formatting the notification, and this is simply a fallback in case it cannot do formatting in time.
        // The reason we put the responsibility on the client is for the following reasons:
        // 1. DM decryption can only be done on the client
        // 2. There is more infrastructure for localizing the text on the client than on the server
        // 3. Offloads the work of pulling profile names and other info to the client who probably has a copy in NostrDB
        // 4. Improves privacy by not requiring extra user info (e.g. locale) to be sent to the server
        const title = "New activity";
        const subtitle = "From: " + event.info.pubkey;
        const body = event.info.content;
        return { title, subtitle, body };
    }

    async saveUserDeviceInfo(pubkey: Pubkey, deviceToken: string) {
        this.throwIfDatabaseNotSetup();

        await this.db.query('INSERT OR REPLACE INTO user_info (id, pubkey, device_token) VALUES (?, ?, ?)', [pubkey + ":" + deviceToken, pubkey, deviceToken]);
    }
}


class NotificationStatus {
    constructor(public statusInfo: Record<Pubkey, boolean>) {
        this.statusInfo = statusInfo;
    }

    pubkeysThatReceivedNotification(): Set<Pubkey> {
        return new Set<Pubkey>(
            Object.entries(this.statusInfo)
                .filter(([_, receivedNotification]) => { return receivedNotification === true })
                .map(([pubkey, _]) => { return pubkey })
        );
    }
}
