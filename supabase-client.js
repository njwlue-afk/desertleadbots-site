// ============================================================================
// Shared Supabase helpers for Desert Lead Bots — used by account.html and
// admin.html. Requires supabase-config.js and the Supabase JS CDN script to
// be loaded first (see the <script> tags near the bottom of each page).
// ============================================================================

const DLB_CONFIGURED = !SUPABASE_URL.startsWith("PASTE_") && !SUPABASE_ANON_KEY.startsWith("PASTE_");
const sb = DLB_CONFIGURED
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// ---- Auth --------------------------------------------------------------
async function dlbSignUp(email, password, fullName) {
  if (!DLB_CONFIGURED) return { data: null, error: { message: "Accounts aren't set up yet." } };
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  return { data, error };
}

async function dlbSignIn(email, password) {
  if (!DLB_CONFIGURED) return { data: null, error: { message: "Accounts aren't set up yet." } };
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  return { data, error };
}

async function dlbSignOut() {
  if (!DLB_CONFIGURED) return;
  await sb.auth.signOut();
}

async function dlbGetSession() {
  if (!DLB_CONFIGURED) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function dlbGetMyProfile() {
  const session = await dlbGetSession();
  if (!session) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .single();
  if (error) {
    console.error("dlbGetMyProfile error", error);
    return null;
  }
  return data;
}

// ---- Chat ---------------------------------------------------------------
async function dlbGetMessages(customerId) {
  if (!DLB_CONFIGURED) return [];
  const { data, error } = await sb
    .from("messages")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("dlbGetMessages error", error);
    return [];
  }
  return data;
}

async function dlbSendMessage(customerId, senderId, body) {
  if (!DLB_CONFIGURED) return false;
  const { error } = await sb
    .from("messages")
    .insert({ customer_id: customerId, sender_id: senderId, body });
  if (error) console.error("dlbSendMessage error", error);
  return !error;
}

function dlbSubscribeToMessages(customerId, onInsert) {
  if (!DLB_CONFIGURED) return null;
  return sb
    .channel(`messages-${customerId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `customer_id=eq.${customerId}`,
      },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
}

// ---- Admin dashboard data -------------------------------------------------
async function dlbGetAllProfiles() {
  if (!DLB_CONFIGURED) return [];
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .order("last_seen_at", { ascending: false });
  if (error) {
    console.error("dlbGetAllProfiles error", error);
    return [];
  }
  return data;
}

async function dlbSetRole(userId, role) {
  if (!DLB_CONFIGURED) return false;
  const { error } = await sb.from("profiles").update({ role }).eq("id", userId);
  return !error;
}

function dlbSubscribeToAllMessages(onInsert) {
  if (!DLB_CONFIGURED) return null;
  return sb
    .channel("all-messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
}

// ---- Visitor tracking -------------------------------------------------------
// Logs a page visit with a best-effort geolocation lookup. Safe to call from
// any page, logged in or not. Fails silently if the geolocation API is
// unreachable (e.g. ad blocker) — the visit still logs, just without a
// city/region/country.
async function dlbLogVisit(page) {
  if (!DLB_CONFIGURED) return;
  let sessionId = sessionStorage.getItem("dlb_session_id");
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem("dlb_session_id", sessionId);
  }

  let geo = {};
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (res.ok) {
      const j = await res.json();
      geo = { city: j.city, region: j.region, country: j.country_name };
    }
  } catch (e) {
    // geolocation lookup failed — that's fine, log the visit anyway
  }

  const session = await dlbGetSession();

  await sb.from("site_visits").insert({
    user_id: session ? session.user.id : null,
    session_id: sessionId,
    page: page || window.location.pathname,
    referrer: document.referrer || null,
    ...geo,
  });

  // If logged in, also refresh their last_seen_at + location on their profile
  // so the admin dashboard shows where each account is actually located.
  if (session) {
    await sb
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString(), ...geo })
      .eq("id", session.user.id);
  }
}

async function dlbGetVisits(limit = 200) {
  if (!DLB_CONFIGURED) return [];
  const { data, error } = await sb
    .from("site_visits")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("dlbGetVisits error", error);
    return [];
  }
  return data;
}

// ---- Visitor messages ("Talk to a human" handoff) --------------------------
// Anonymous visitors (not signed in) can send one of these from the public
// site. Staff/admin see and resolve them from the admin dashboard. This is
// completely separate from the Chatbase bot widget and from the signed-in
// customer chat (messages table) — it's a standalone inbox.
async function dlbSendVisitorMessage(name, contact, message, page) {
  if (!DLB_CONFIGURED) return false;
  const { error } = await sb.from("visitor_messages").insert({
    name: name || null,
    contact: contact || null,
    message,
    page: page || window.location.pathname,
  });
  if (error) console.error("dlbSendVisitorMessage error", error);
  return !error;
}

async function dlbGetVisitorMessages(limit = 200) {
  if (!DLB_CONFIGURED) return [];
  const { data, error } = await sb
    .from("visitor_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("dlbGetVisitorMessages error", error);
    return [];
  }
  return data;
}

async function dlbMarkVisitorMessageResolved(id, resolved) {
  if (!DLB_CONFIGURED) return false;
  const { error } = await sb
    .from("visitor_messages")
    .update({ resolved })
    .eq("id", id);
  if (error) console.error("dlbMarkVisitorMessageResolved error", error);
  return !error;
}

function dlbSubscribeToVisitorMessages(onInsert) {
  if (!DLB_CONFIGURED) return null;
  return sb
    .channel("visitor-messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "visitor_messages" },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
}
