import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabaseConfig.js";

const HAS_PLACEHOLDER_URL = /YOUR-PROJECT-REF/.test(SUPABASE_URL);
const HAS_PLACEHOLDER_KEY = /YOUR-SUPABASE-ANON-KEY/.test(SUPABASE_ANON_KEY);
const IS_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && !HAS_PLACEHOLDER_URL && !HAS_PLACEHOLDER_KEY);

const supabase = IS_CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;

function ensureClient() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function currentUserId() {
  const client = ensureClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error("No authenticated user.");
  return data.user.id;
}

export function isSupabaseConfigured() {
  return Boolean(supabase);
}

export function supabaseConfigMessage() {
  return isSupabaseConfigured()
    ? ""
    : "Set js/supabaseConfig.js with your Supabase project URL and anon key.";
}

export async function getAuthSession() {
  const client = ensureClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

export function onAuthStateChange(callback) {
  if (!supabase) {
    return { data: { subscription: { unsubscribe() {} } } };
  }
  return supabase.auth.onAuthStateChange((_event, session) => callback(session || null));
}

export async function signInWithPassword(email, password) {
  const client = ensureClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
}

export async function signUpWithPassword(email, password) {
  const client = ensureClient();
  const { error } = await client.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
}

export async function signOutSession() {
  const client = ensureClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function listCloudProjects() {
  const client = ensureClient();
  const { data, error } = await client
    .from("projects")
    .select("id, name, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createCloudProject({ name, document }) {
  const client = ensureClient();
  const userId = await currentUserId();
  const { data, error } = await client
    .from("projects")
    .insert({ user_id: userId, name, document })
    .select("id, name, updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function updateCloudProject({ id, name, document }) {
  const client = ensureClient();
  const patch = { document };
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
  const { data, error } = await client
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select("id, name, updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function loadCloudProject(projectId) {
  const client = ensureClient();
  const { data, error } = await client
    .from("projects")
    .select("id, name, document, updated_at")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  return data;
}

export async function renameCloudProject(projectId, name) {
  const client = ensureClient();
  const { data, error } = await client
    .from("projects")
    .update({ name: name.trim() })
    .eq("id", projectId)
    .select("id, name, updated_at")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCloudProject(projectId) {
  const client = ensureClient();
  const { error } = await client.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

export async function listQuarries() {
  const client = ensureClient();
  let query = client
    .from("quarries")
    .select("id, name, default_rock_density, active, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
