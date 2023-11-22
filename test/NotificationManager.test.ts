import { NotificationManager } from "../src/NotificationManager.ts";
import { assertEquals, assert } from "https://deno.land/std@0.207.0/assert/mod.ts";
import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";

Deno.test("NotificationManager - setupDatabase should be idempotent", async () => {
    // Check if there is `test.db` file. If there is, fail the test and tell the user to delete or rename it.
    try {
        await Deno.stat("test.db");
        assert(false, "test.db already exists. Please delete or rename it.");
    } catch (_) {
        // If the file does not exist, that's good.
    }

    const notificationManager = new NotificationManager("test.db");
    await notificationManager.setupDatabase();
    await notificationManager.setupDatabase();  // Run it a second time to check idempotency
    await notificationManager.closeDatabase();  // Let go of the file handle
    
    const db = new DB("test.db");

    // Check notifications table
    const columns = [...db.query("PRAGMA table_info(notifications)")];
    assertEquals(columns.length, 5);

    // Check user_info table
    const user_info_columns = [...db.query("PRAGMA table_info(user_info)")];
    assertEquals(user_info_columns.length, 4);

    // Let go of the file handle
    db.close();

    // Delete the test.db file
    await Deno.remove("test.db");
});
