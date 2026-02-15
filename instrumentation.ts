// This file configures the initialization of Sentry for server components and serverside utilities.
// It loads on Node.js server startup and initializes Sentry for the server environment.

export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        await import("./sentry.server.config");
    }

    if (process.env.NEXT_RUNTIME === "edge") {
        await import("./sentry.edge.config");
    }
}
