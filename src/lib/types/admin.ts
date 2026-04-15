export interface StandardPendingUser {
    id: string;
    name: string;
    email: string;
    phone?: string;
    dob?: string;
    address?: string;
    state?: string;
    lga?: string;
}

export interface StandardPendingForm<T = any> {
    id: string;
    user: StandardPendingUser;
    status: string;
    data: T;
}
