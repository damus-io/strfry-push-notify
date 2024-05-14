import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";
import { Pubkey } from "./types.ts";
import { NostrEvent } from "./NostrEvent.ts";
import { load } from "https://deno.land/std@0.205.0/dotenv/mod.ts";
import https from "node:https";
import fs from "node:fs";
import { MuteManager } from "./MuteManager.ts";

const env = await load();
const APNS_SERVER_BASE_URL = env["APNS_SERVER_BASE_URL"] || "http://localhost:8001/push-notification/"; // Probably api.development.push.apple.com/3/device for development, api.push.apple.com/3/device for production
const APNS_AUTH_METHOD: "certificate" | "token" = env["APNS_AUTH_METHOD"] as ("certificate" | "token") || "token";
const APNS_AUTH_TOKEN = env["APNS_AUTH_TOKEN"];
const APNS_TOPIC = env["APNS_TOPIC"] || "com.jb55.damus2";
const APNS_CERTIFICATE_FILE_PATH = env["APNS_CERTIFICATE_FILE_PATH"] || "./apns_cert.pem";
const APNS_CERTIFICATE_KEY_FILE_PATH = env["APNS_CERTIFICATE_KEY_FILE_PATH"] || "./apns_key.pem";
const DB_PATH = env["DB_PATH"] || "./apns_notifications.db";
const RELAY_URL = env["RELAY_URL"] || "ws://localhost";

// The NotificationManager has three main responsibilities:
// 1. Keep track of pubkeys and associated iOS device tokens
// 2. Keep track of which pubkeys have received notifications for each event, so that we don't send duplicate notifications
// 3. Send notifications to the relevant iOS devices when a new event is received
export class NotificationManager {
    private dbPath: string;
    private db: DB;
    private isDatabaseSetup: boolean;
    private muteManager: MuteManager;

    constructor(dbPath?: string | undefined, relayUrl?: string | undefined) {
        this.dbPath = dbPath || DB_PATH;
        this.db = new DB(this.dbPath);
        this.isDatabaseSetup = false;
        this.muteManager = new MuteManager(relayUrl || RELAY_URL);
    }

    async setupDatabase() {
        // V1 of the database schema
        // Create a table of notification statuses for each event
        await this.db.execute('CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, event_id TEXT, pubkey TEXT, received_notification BOOLEAN)');
        // Create an index on the event_id column for faster lookups
        await this.db.execute('CREATE INDEX IF NOT EXISTS notification_event_id_index ON notifications (event_id)');
        // Create a table of device tokens and associated pubkeys
        await this.db.execute('CREATE TABLE IF NOT EXISTS user_info (id TEXT PRIMARY KEY, device_token TEXT, pubkey TEXT)');
        // Create an index on the pubkey column for faster lookups
        await this.db.execute('CREATE INDEX IF NOT EXISTS user_info_pubkey_index ON user_info (pubkey)');

        // V2 migration of the database schema
        // Add a "sent_at" column to the notifications table to track UNIX timestamps of when notifications were sent
        await this.addColumnIfNotExists('notifications', 'sent_at', 'INTEGER');
        // Add an "added_at" column to the `user_info` table to track UNIX timestamps of when device tokens were added
        await this.addColumnIfNotExists('user_info', 'added_at', 'INTEGER');
        this.isDatabaseSetup = true;
    };

    // SECURITY NOTE: This function is not SQL injection safe, only use this for internal queries. NEVER use this with user input.
    private async addColumnIfNotExists(tableName: string, columnName: string, columnType: string) {
        // This query only works with string interpolation, so it is not SQL injection safe.
        const resultRows: Array<[number, string, string, number, null, number]> = await this.db.query(`PRAGMA table_info(${tableName})`);
        const columnNames = resultRows.map(([_cid, name, _type, _notnull, _dflt_value, _pk]) => { return name });
        if (!columnNames.includes(columnName)) {
            // This query only works with string interpolation, so it is not SQL injection safe.
            await this.db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`)
        }
    }

    throwIfDatabaseNotSetup() {
        if (!this.isDatabaseSetup) {
            throw new Error("Database not setup. Run setupDatabase() first.");
        }
    }

    async closeDatabase() {
        await this.db.close();
        this.isDatabaseSetup = false;
    }

    async sendNotificationsIfNeeded(event: NostrEvent) {
        this.throwIfDatabaseNotSetup();

        // 0. Check if event is more than 1 week old. If so, do not send notifications.
        const currentTimeUnix = getCurrentTimeUnix();
        const oneWeekAgo = currentTimeUnix - 7 * 24 * 60 * 60;
        if (event.info.created_at < oneWeekAgo) {
            return;
        }
    
        // 1. Determine which pubkeys to notify
        const pubkeysToNotify = await this.pubkeysToNotifyForEvent(event);
        
        // 2. Send the notifications to them and record that we sent them
        for(const pubkey of pubkeysToNotify) {
            await this.sendEventNotificationsToPubkey(event, pubkey);
            // Record that we sent the notification
            await this.db.query('INSERT OR REPLACE INTO notifications (id, event_id, pubkey, received_notification, sent_at) VALUES (?, ?, ?, ?, ?)', [event.info.id + ":" + pubkey, event.info.id, pubkey, true, currentTimeUnix]);
        }    
    };

    /**
     * Retrieves the set of public keys to notify for a given event.
     * 
     * @param event - The NostrEvent object representing the event.
     * @returns A Promise that resolves to a Set of Pubkey objects representing the public keys to notify.
     */
    async pubkeysToNotifyForEvent(event: NostrEvent): Promise<Set<Pubkey>> {
        const notificationStatusForThisEvent: NotificationStatus = await this.getNotificationStatus(event);
        const relevantPubkeys: Set<Pubkey> = await this.pubkeysRelevantToEvent(event);
        const pubkeysThatReceivedNotification = notificationStatusForThisEvent.pubkeysThatReceivedNotification();
        const relevantPubkeysYetToReceive = new Set<Pubkey>(
            [...relevantPubkeys].filter(x => !pubkeysThatReceivedNotification.has(x) && x !== event.info.pubkey)
        );

        const pubkeysToNotify = new Set<Pubkey>();
        for (const pubkey of relevantPubkeysYetToReceive) {
            const shouldMuteNotification = await this.muteManager.shouldMuteNotificationForPubkey(event, pubkey);
            if (!shouldMuteNotification) {
                pubkeysToNotify.add(pubkey);
            }
        }
        return pubkeysToNotify;
    }

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

            https.request(options).end();
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
                nostr_event: JSON.stringify(event.info),
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

        const currentTimeUnix = getCurrentTimeUnix();
        await this.db.query('INSERT OR REPLACE INTO user_info (id, pubkey, device_token, added_at) VALUES (?, ?, ?, ?)', [pubkey + ":" + deviceToken, pubkey, deviceToken, currentTimeUnix]);
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

function getCurrentTimeUnix(): number {
    return Math.floor((new Date().getTime())/1000);
}
