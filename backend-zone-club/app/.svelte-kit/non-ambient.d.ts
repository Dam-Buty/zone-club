
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/admin" | "/admin/films" | "/api" | "/api/admin" | "/api/admin/films" | "/api/admin/films/[filmId]" | "/api/admin/films/[filmId]/availability" | "/api/admin/requests" | "/api/admin/requests/[id]" | "/api/admin/stats" | "/api/auth" | "/api/auth/login" | "/api/auth/logout" | "/api/auth/recover" | "/api/auth/register" | "/api/films" | "/api/films/genre" | "/api/films/genre/[slug]" | "/api/films/[tmdbId]" | "/api/genres" | "/api/me" | "/api/rentals" | "/api/rentals/[filmId]" | "/api/requests" | "/api/reviews" | "/api/reviews/[filmId]" | "/compte" | "/film" | "/film/[id]" | "/film/[id]/review" | "/film/[id]/watch" | "/login" | "/rayons" | "/rayons/[slug]" | "/recover" | "/register";
		RouteParams(): {
			"/api/admin/films/[filmId]": { filmId: string };
			"/api/admin/films/[filmId]/availability": { filmId: string };
			"/api/admin/requests/[id]": { id: string };
			"/api/films/genre/[slug]": { slug: string };
			"/api/films/[tmdbId]": { tmdbId: string };
			"/api/rentals/[filmId]": { filmId: string };
			"/api/reviews/[filmId]": { filmId: string };
			"/film/[id]": { id: string };
			"/film/[id]/review": { id: string };
			"/film/[id]/watch": { id: string };
			"/rayons/[slug]": { slug: string }
		};
		LayoutParams(): {
			"/": { filmId?: string; id?: string; slug?: string; tmdbId?: string };
			"/admin": Record<string, never>;
			"/admin/films": Record<string, never>;
			"/api": { filmId?: string; id?: string; slug?: string; tmdbId?: string };
			"/api/admin": { filmId?: string; id?: string };
			"/api/admin/films": { filmId?: string };
			"/api/admin/films/[filmId]": { filmId: string };
			"/api/admin/films/[filmId]/availability": { filmId: string };
			"/api/admin/requests": { id?: string };
			"/api/admin/requests/[id]": { id: string };
			"/api/admin/stats": Record<string, never>;
			"/api/auth": Record<string, never>;
			"/api/auth/login": Record<string, never>;
			"/api/auth/logout": Record<string, never>;
			"/api/auth/recover": Record<string, never>;
			"/api/auth/register": Record<string, never>;
			"/api/films": { slug?: string; tmdbId?: string };
			"/api/films/genre": { slug?: string };
			"/api/films/genre/[slug]": { slug: string };
			"/api/films/[tmdbId]": { tmdbId: string };
			"/api/genres": Record<string, never>;
			"/api/me": Record<string, never>;
			"/api/rentals": { filmId?: string };
			"/api/rentals/[filmId]": { filmId: string };
			"/api/requests": Record<string, never>;
			"/api/reviews": { filmId?: string };
			"/api/reviews/[filmId]": { filmId: string };
			"/compte": Record<string, never>;
			"/film": { id?: string };
			"/film/[id]": { id: string };
			"/film/[id]/review": { id: string };
			"/film/[id]/watch": { id: string };
			"/login": Record<string, never>;
			"/rayons": { slug?: string };
			"/rayons/[slug]": { slug: string };
			"/recover": Record<string, never>;
			"/register": Record<string, never>
		};
		Pathname(): "/" | "/admin" | "/admin/" | "/admin/films" | "/admin/films/" | "/api" | "/api/" | "/api/admin" | "/api/admin/" | "/api/admin/films" | "/api/admin/films/" | `/api/admin/films/${string}` & {} | `/api/admin/films/${string}/` & {} | `/api/admin/films/${string}/availability` & {} | `/api/admin/films/${string}/availability/` & {} | "/api/admin/requests" | "/api/admin/requests/" | `/api/admin/requests/${string}` & {} | `/api/admin/requests/${string}/` & {} | "/api/admin/stats" | "/api/admin/stats/" | "/api/auth" | "/api/auth/" | "/api/auth/login" | "/api/auth/login/" | "/api/auth/logout" | "/api/auth/logout/" | "/api/auth/recover" | "/api/auth/recover/" | "/api/auth/register" | "/api/auth/register/" | "/api/films" | "/api/films/" | "/api/films/genre" | "/api/films/genre/" | `/api/films/genre/${string}` & {} | `/api/films/genre/${string}/` & {} | `/api/films/${string}` & {} | `/api/films/${string}/` & {} | "/api/genres" | "/api/genres/" | "/api/me" | "/api/me/" | "/api/rentals" | "/api/rentals/" | `/api/rentals/${string}` & {} | `/api/rentals/${string}/` & {} | "/api/requests" | "/api/requests/" | "/api/reviews" | "/api/reviews/" | `/api/reviews/${string}` & {} | `/api/reviews/${string}/` & {} | "/compte" | "/compte/" | "/film" | "/film/" | `/film/${string}` & {} | `/film/${string}/` & {} | `/film/${string}/review` & {} | `/film/${string}/review/` & {} | `/film/${string}/watch` & {} | `/film/${string}/watch/` & {} | "/login" | "/login/" | "/rayons" | "/rayons/" | `/rayons/${string}` & {} | `/rayons/${string}/` & {} | "/recover" | "/recover/" | "/register" | "/register/";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/robots.txt" | string & {};
	}
}