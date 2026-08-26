/**
 * Loading a settings form, without turning a failed read into a silent reset.
 *
 *   #295 THREE ADMIN SETTINGS SCREENS SHOWED HARDCODED DEFAULTS WHEN THE LOAD
 *        FAILED, AND SAVING THEN WROTE THOSE DEFAULTS OVER THE STORED VALUES.
 *
 *        All three had the same four lines:
 *
 *            const [settings, setSettings] = useState(DEFAULTS);
 *            ...
 *            const res = await fetch("/api/admin/settings/x");
 *            const data = await res.json();
 *            if (data.success && data.settings) setSettings(data.settings);
 *            catch { /* use defaults if fetch fails *​/ }
 *
 *        The form starts as a hardcoded default object. Every failure — a
 *        network throw, a non-2xx (the status was never checked at all), a body
 *        reporting success:false, a missing `settings` key — leaves those
 *        defaults sitting in the form, and `isLoading` goes false regardless,
 *        so the screen renders exactly as if it had loaded.
 *
 *        THE SAVE POSTS THE WHOLE OBJECT. So an admin who opens the page during
 *        a blip, changes one field and presses Save silently overwrites every
 *        OTHER setting with a default they never chose and were never shown as
 *        a default.
 *
 *        On /admin/settings/security that is session duration, idle timeout,
 *        max login attempts, lockout duration and enforceMfa — the MFA
 *        enforcement flag being reset by a transient network error is the sharp
 *        end of it. #172 was a kill switch that failed OPEN on a database
 *        error; this is a security configuration that fails to DEFAULTS on a
 *        fetch error and then persists them.
 *
 * WHY A MODULE
 * ------------
 * The read was written three times and was wrong the same way three times, and
 * the correct version has a part that is easy to leave out: `res.ok`. Two of
 * the three never checked it, so a 500 whose body happened to parse was treated
 * as data.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not retry, and it does not fall back to anything. A settings form
 * that cannot read its settings has nothing useful to show, and the only safe
 * action is to say so and refuse to save — which is the caller's job, and what
 * SETTINGS_LOAD_FAILED_MESSAGE is for.
 */

export type SettingsLoad<T> =
    | { ok: true; settings: T }
    | { ok: false; reason: string };

/** Shown when the form could not read what is stored. One sentence, three screens. */
export const SETTINGS_LOAD_FAILED_MESSAGE =
    "These settings could not be loaded, so the values below are defaults rather than what is saved. Saving now would overwrite the stored settings — reload before making changes.";

/**
 * Read a settings endpoint, failing CLOSED.
 *
 * Returns ok:false for every case the old inline version treated as "just use
 * the defaults": a throw, a non-2xx, an unparseable body, `success: false`, or
 * a missing `settings` key.
 */
export async function loadSettings<T>(url: string): Promise<SettingsLoad<T>> {
    let res: Response;

    try {
        res = await fetch(url);
    } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : "Network error" };
    }

    // Never checked on two of the three screens, so a 500 with a JSON body was
    // read as though it were settings.
    if (!res.ok) {
        return { ok: false, reason: `Request failed (${res.status})` };
    }

    let body: any;
    try {
        body = await res.json();
    } catch {
        return { ok: false, reason: "The response was not readable" };
    }

    if (body?.success === false) {
        return { ok: false, reason: String(body.error || "The server refused the request") };
    }

    if (!body?.settings) {
        return { ok: false, reason: "The response carried no settings" };
    }

    return { ok: true, settings: body.settings as T };
}
