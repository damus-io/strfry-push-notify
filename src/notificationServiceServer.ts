
import { Application, Router, Context } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { NotificationManager } from "./NotificationManager.ts";
import { nip98_verify_auth_header } from "./nip98_auth.ts";
import { load } from "https://deno.land/std@0.205.0/dotenv/mod.ts";

const env = await load();
const BASE_URL = env["API_BASE_URL"];
if (!BASE_URL) {
    throw new Error("API_BASE_URL environment variable not set");
}

const app = new Application();
const router = new Router();

// Add a middleware that logs the request
app.use(async (ctx, next) => {
    await next();
    let authorized_pubkey_log_string = "";
    if (ctx.state.authorized_pubkey) {
        authorized_pubkey_log_string = ` (authorized pubkey: ${ctx.state.authorized_pubkey})`;
    }
    console.log(`[${ctx.request.method}] ${ctx.request.url}${authorized_pubkey_log_string}: ${ctx.response.status}`);
});

// MARK: - NIP-98 authenticated endpoints

app.use(async (ctx, next) => {
    const authHeader = ctx.request.headers.get("Authorization");
    if (!authHeader) {
        ctx.response.status = 401;
        ctx.response.body = "No authorization header provided";
        return;
    }

    const body = await ctx.request.body({ type: "bytes" });
    const bodyValue = await body.value;

    const { authorized_pubkey, error } = await nip98_verify_auth_header(
        authHeader,
        BASE_URL + ctx.request.url.pathname,
        ctx.request.method,
        bodyValue
    )

    if (error) {
        ctx.response.status = 401;
        ctx.response.body = error;
        return;
    }

    if (!authorized_pubkey) {
        ctx.response.status = 401;
        ctx.response.body = "No authorized pubkey found";
        return;
    }

    ctx.state.authorized_pubkey = authorized_pubkey;

    await next();
});

// Define the endpoint for the client to send device tokens to
router.post("/user-info", async (ctx: Context) => {
    const body = await ctx.request.body();
    const bodyValue = await body.value;

    const { deviceToken, pubkey } = bodyValue

    if (pubkey !== ctx.state.authorized_pubkey) {
        ctx.response.status = 403
        ctx.response.body = "Pubkey does not match authorized pubkey";
        return;
    }

    const notificationManager = new NotificationManager();
    await notificationManager.setupDatabase()
    notificationManager.saveUserDeviceInfo(pubkey, deviceToken);
    ctx.response.body = "User info saved successfully";
});

// Define the endpoint for the client to revoke device tokens
router.post("/user-info/remove", async (ctx: Context) => {
    const body = await ctx.request.body();
    const bodyValue = await body.value;
    
    const { pubkey, deviceToken } = bodyValue

    if (pubkey !== ctx.state.authorized_pubkey) {
        ctx.response.status = 403;
        ctx.response.body = "Pubkey does not match authorized pubkey";
        return;
    }

    const notificationManager = new NotificationManager();
    await notificationManager.setupDatabase()
    notificationManager.removeUserDeviceInfo(pubkey, deviceToken);
    ctx.response.body = "User info removed successfully";
});

app.use(router.routes());
app.use(router.allowedMethods());

console.log("Server running on port 8000");

await app.listen({ port: 8000 });
