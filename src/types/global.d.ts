import { Firestore } from 'firebase/firestore';
import { Auth } from 'firebase/auth';

declare global {
    var testDb: Firestore;
    var testAuth: Auth;
}

export { };
