export interface StandardPendingUser {
    id: string;
    name: string;
    email: string;
}

export interface StandardPendingForm<T = any> {
    id: string;
    user: StandardPendingUser;
    status: string;
    data: T;
}
