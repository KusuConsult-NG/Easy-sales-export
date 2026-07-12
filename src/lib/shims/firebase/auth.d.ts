export function getAuth(app?: any): any;
export function signOut(auth: any): Promise<void>;
export function signInWithCustomToken(auth: any, token: string): Promise<any>;
export function signInWithEmailAndPassword(auth: any, email: string, pass: string): Promise<any>;
export type Auth = any;
export type User = any;
