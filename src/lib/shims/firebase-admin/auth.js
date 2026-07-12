const { supabaseAdmin } = require('../../supabase');

class MockAuth {
  async createUser(params) {
    const { email, password, displayName } = params;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: displayName }
    });
    if (error) throw new Error(error.message);
    return {
        uid: data.user.id,
        email: data.user.email,
        displayName: data.user.user_metadata?.full_name,
    };
  }
  
  async updateUser(uid, params) {
    const updateData = {};
    if (params.email) updateData.email = params.email;
    if (params.password) updateData.password = params.password;
    if (params.displayName) updateData.user_metadata = { full_name: params.displayName };
    
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(uid, updateData);
    if (error) throw new Error(error.message);
    return {
        uid: data.user.id,
        email: data.user.email,
        displayName: data.user.user_metadata?.full_name,
    };
  }
  
  async deleteUser(uid) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) throw new Error(error.message);
    return {};
  }
  
  async deleteUsers(uids) {
    for (const uid of uids) {
        await supabaseAdmin.auth.admin.deleteUser(uid);
    }
    return { failureCount: 0, successes: uids.length };
  }
  
  async getUserByEmail(email) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw new Error(error.message);
    const user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) {
        const err = new Error("User not found");
        err.code = "auth/user-not-found";
        throw err;
    }
    return {
        uid: user.id,
        email: user.email,
        displayName: user.user_metadata?.full_name,
    };
  }
  
  async getUser(uid) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error("User not found");
    return {
        uid: data.user.id,
        email: data.user.email,
        displayName: data.user.user_metadata?.full_name,
    };
  }
  
  async listUsers(maxResults, pageToken) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw new Error(error.message);
    return {
        users: data.users.map(u => ({
            uid: u.id,
            email: u.email,
            displayName: u.user_metadata?.full_name,
        })),
        pageToken: undefined
    };
  }
  
  async createCustomToken(uid, claims) {
    return "mock-custom-token";
  }
}

module.exports = {
  getAuth: () => new MockAuth()
};
