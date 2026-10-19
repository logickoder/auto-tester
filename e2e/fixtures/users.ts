import path from "node:path";

export type Role = "userA" | "userB";

/** FR-3: credentials come only from environment variables — never from code. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Test credentials come from environment variables only.`);
  return value;
}

type User = { readonly email: string; readonly password: string; readonly displayName: string };

// Getters so importing this file without the env set does not throw.
export const USERS: Record<Role, User> = {
  userA: {
    get email() {
      return required("USER_A_EMAIL");
    },
    get password() {
      return required("USER_A_PASSWORD");
    },
    get displayName() {
      return process.env.USER_A_NAME ?? required("USER_A_EMAIL");
    },
  },
  userB: {
    get email() {
      return required("USER_B_EMAIL");
    },
    get password() {
      return required("USER_B_PASSWORD");
    },
    get displayName() {
      return process.env.USER_B_NAME ?? required("USER_B_EMAIL");
    },
  },
};

/** Where global.setup.ts saves each role's logged-in browser state. */
export const statePath = (role: Role) => path.join(".auth", `${role}.json`);
