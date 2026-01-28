import type { User } from '$lib/server/auth';

declare global {
    namespace App {
        interface Locals {
            user: User | null;
        }
    }
}

export {};
