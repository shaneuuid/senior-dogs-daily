import OAuth from 'oauth-1.0a';
import { HmacSHA1, enc } from 'crypto-js';
import { Buffer } from 'node:buffer';

export interface Env {
	KV_BOTS_SOCIAL_MEDIA_POSTER_POSTED_DOGS: KVNamespace;
	PETFINDER_CLIENT_ID: string;
	PETFINDER_CLIENT_SECRET: string;
	X_ACCESS_TOKEN: string;
	X_ACCESS_TOKEN_SECRET: string;
	X_API_KEY: string;
	X_API_SECRET: string;
}

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		try {
			const petfinder = await Petfinder(
				env.PETFINDER_CLIENT_ID,
				env.PETFINDER_CLIENT_SECRET,
			);

			const petfinderGetAnimalsResponse = await petfinder.getAnimals({
				age: 'senior',
				limit: 50,
				type: 'Dog',
			});

			const postedDogs =
				await env.KV_BOTS_SOCIAL_MEDIA_POSTER_POSTED_DOGS.list();

			let dog: PetfinderAnimal | undefined;
			for (const animal of petfinderGetAnimalsResponse.animals) {
				if (
					animal.photos.length > 0 &&
					!postedDogs.keys.some((key) => key.name === String(animal.id))
				) {
					dog = animal;
				}
			}

			if (dog) {
				await env.KV_BOTS_SOCIAL_MEDIA_POSTER_POSTED_DOGS.put(
					String(dog.id),
					'',
				);

				const getDogPhotoFetchPromises: Promise<Response>[] = [];
				// X allows 4 photo attachments per tweet.
				let photoCount = 0;
				for (const photo in dog.photos) {
					if (photoCount < 4) {
						getDogPhotoFetchPromises.push(fetch(dog.photos[photo].full));
					}
				}
				const getDogPhotoFetchResults = await Promise.all(
					getDogPhotoFetchPromises,
				);

				const getDogPhotoArrayBufferPromises: Promise<ArrayBuffer>[] = [];
				for (const result in getDogPhotoFetchResults) {
					getDogPhotoArrayBufferPromises.push(
						getDogPhotoFetchResults[result].arrayBuffer(),
					);
				}
				const getDogPhotoArrayBufferResults = await Promise.all(
					getDogPhotoArrayBufferPromises,
				);

				const dogBase64Photos: string[] = [];
				for (const result in getDogPhotoArrayBufferResults) {
					dogBase64Photos.push(
						Buffer.from(getDogPhotoArrayBufferResults[result]).toString(
							'base64',
						),
					);
				}

				const xV1Media = XV1Media({
					accessToken: env.X_ACCESS_TOKEN,
					accessTokenSecret: env.X_ACCESS_TOKEN_SECRET,
					apiKey: env.X_API_KEY,
					apiSecret: env.X_API_SECRET,
				});

				const xV1MediaUploadPromises: Promise<XV1MediaUploadResponse>[] = [];
				for (const base64Photo in dogBase64Photos) {
					xV1MediaUploadPromises.push(
						xV1Media.upload({
							media_category: 'tweet_image',
							media_data: dogBase64Photos[base64Photo],
						}),
					);
				}

				const xV1MediaUploadResults = await Promise.all(xV1MediaUploadPromises);

				const xV2 = XV2({
					accessToken: env.X_ACCESS_TOKEN,
					accessTokenSecret: env.X_ACCESS_TOKEN_SECRET,
					apiKey: env.X_API_KEY,
					apiSecret: env.X_API_SECRET,
				});

				const mediaIds: string[] = [];
				for (const result in xV1MediaUploadResults) {
					mediaIds.push(xV1MediaUploadResults[result].media_id_string);
				}

				await xV2.createTweet({
					text:
						dog.contact.address.city +
						', ' +
						dog.contact.address.state +
						' | ' +
						dog.name +
						' | ' +
						dog.url,
					media: {
						media_ids: mediaIds,
					},
				});
			}
		} catch (error) {
			console.error(error);
		}
	},
};

type PetfinderCreateApiTokenResponse = {
	token_type: 'Bearer';
	expires_in: number;
	access_token: string;
};

type PetfinderGetAnimalsResponse = {
	animals: PetfinderAnimal[];
	pagination: PetfinderPagination;
};

type PetfinderGetAnimalsQueryParams = {
	type?: string;
	breed?: string;
	size?: string;
	gender?: string;
	age?: string;
	color?: string;
	coat?: string;
	status?: string;
	name?: string;
	organization?: string;
	good_with_children?: boolean;
	good_with_dogs?: boolean;
	good_with_cats?: boolean;
	house_trained?: boolean;
	declawed?: boolean;
	special_needs?: boolean;
	location?: string;
	distance?: number;
	before?: string;
	after?: string;
	sort?: string;
	page?: number;
	limit?: number;
};

type PetfinderAnimal = {
	id: number;
	organization_id: string;
	url: string;
	type: string;
	species: string;
	breeds: PetfinderAnimalBreed;
	colors: PetfinderAnimalColors;
	age: string;
	gender: string;
	size: string;
	coat: string | null;
	attributes: PetfinderAnimalAttributes;
	environment: PetfinderAnimalEnvironment;
	tags: string[];
	name: string;
	description: string;
	photos: PetfinderAnimalPhoto[];
	videos: PetfinderAnimalVideo[];
	status: string;
	published_at: string;
	contact: PetfinderAnimalContact;
	_links: PetfinderAnimalLinks;
};

type PetfinderAnimalBreed = {
	primary: string;
	secondary: string | null;
	mixed: boolean;
	unknown: boolean;
};

type PetfinderAnimalColors = {
	primary: string | null;
	secondary: string | null;
	tertiary: string | null;
};

type PetfinderAnimalAttributes = {
	spayed_neutered: boolean;
	house_trained: boolean;
	declawed: boolean | null;
	special_needs: boolean;
	shots_current: boolean;
};

type PetfinderAnimalEnvironment = {
	children: boolean;
	dogs: boolean;
	cats: boolean;
};

type PetfinderAnimalPhoto = {
	small: string;
	medium: string;
	large: string;
	full: string;
};

type PetfinderAnimalVideo = {
	embed: string;
};

type PetfinderAnimalContactAddress = {
	address1: string;
	address2: string;
	city: string;
	state: string;
	postcode: string;
	country: string;
};

type PetfinderAnimalContact = {
	email: string;
	phone: string;
	address: PetfinderAnimalContactAddress;
};

type PetfinderAnimalLinks = {
	self: {
		href: string;
	};
	type: {
		href: string;
	};
	organization: {
		href: string;
	};
};

type PetfinderPagination = {
	count_per_page: number;
	total_count: number;
	current_page: number;
	total_pages: number;
	_links: PetfinderPaginationLinks;
};

type PetfinderPaginationLinks = {
	previous: {
		href: string;
	};
	next: {
		href: string;
	};
};

/** Returns a client for interacting with Petfinder's API. */
async function Petfinder(clientId: string, clientSecret: string) {
	const baseUrl = 'https://api.petfinder.com/v2';

	/**
	 * Petfinder API requires an expiring bearer token in order to access
	 * resources.
	 *
	 * https://www.petfinder.com/developers/v2/docs/#using-the-api
	 */
	const createBearerTokenResult = await createBearerToken();

	const bearerToken = createBearerTokenResult.access_token;

	async function createBearerToken() {
		const fetchResponse = await fetch(baseUrl + '/' + 'oauth2/token', {
			method: 'POST',
			body: new URLSearchParams({
				grant_type: 'client_credentials',
				client_id: clientId,
				client_secret: clientSecret,
			}),
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		});
		const parsedFetchResponse =
			(await fetchResponse.json()) as PetfinderCreateApiTokenResponse;
		return parsedFetchResponse;
	}

	/** https://www.petfinder.com/developers/v2/docs/#get-animals */
	async function getAnimals(queryParams?: PetfinderGetAnimalsQueryParams) {
		const url = new URL(baseUrl + '/animals');
		if (queryParams) {
			url.search =
				setDecodedObjectAsEncodedUrlSearchParams(queryParams).toString();
		}
		const fetchResponse = await fetch(url, {
			headers: {
				Authorization: 'Bearer ' + bearerToken,
			},
		});
		return (await fetchResponse.json()) as PetfinderGetAnimalsResponse;
	}

	return {
		getAnimals,
	};
}

type XV1MediaUploadPostBody = {
	media_data: string;
	media_category: 'tweet_image';
};

type XV1MediaUploadResponse = {
	media_id: number;
	media_id_string: string;
	media_key: string;
	size: number;
	expires_after_secs: 86400;
	image: {
		image_type: string;
		w: number;
		h: number;
	};
};

/** Returns a client for interacting with X's V1 upload API. */
function XV1Media(options: {
	accessToken: string;
	accessTokenSecret: string;
	apiKey: string;
	apiSecret: string;
}) {
	const url = 'https://upload.twitter.com/1.1/media/upload.json';

	const oauth = new OAuth({
		consumer: { key: options.apiKey, secret: options.apiSecret },
		signature_method: 'HMAC-SHA1',
		hash_function(baseString, key) {
			return HmacSHA1(baseString, key).toString(enc.Base64);
		},
	});

	const oauthToken = {
		key: options.accessToken,
		secret: options.accessTokenSecret,
	};

	/** https://developer.twitter.com/en/docs/twitter-api/v1/media/upload-media/api-reference/post-media-upload */
	async function upload(postBody: XV1MediaUploadPostBody) {
		const oAuthRequest = {
			url,
			method: 'POST',
			data: postBody,
		};
		const fetchResponse = await fetch(url, {
			method: 'POST',
			headers: {
				...oauth.toHeader(oauth.authorize(oAuthRequest, oauthToken)),
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: setDecodedObjectAsEncodedUrlSearchParams(postBody),
		});
		return (await fetchResponse.json()) as XV1MediaUploadResponse;
	}

	return {
		upload,
	};
}

type XV2CreateTweetPostBody = {
	text: string;
	media: {
		media_ids: string[];
	};
};

type XV2CreateTweetResponse = {
	id: string;
	text: string;
};

/** Returns a client for interacting with X's V2 API. */
function XV2(options: {
	accessToken: string;
	accessTokenSecret: string;
	apiKey: string;
	apiSecret: string;
}) {
	const baseUrl = 'https://api.twitter.com/2';

	const oauth = new OAuth({
		consumer: { key: options.apiKey, secret: options.apiSecret },
		signature_method: 'HMAC-SHA1',
		hash_function(baseString, key) {
			return HmacSHA1(baseString, key).toString(enc.Base64);
		},
	});

	const oauthToken = {
		key: options.accessToken,
		secret: options.accessTokenSecret,
	};

	/** https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets */
	async function createTweet(postBody: XV2CreateTweetPostBody) {
		const url = baseUrl + '/tweets';
		const oAuthRequest = {
			url,
			method: 'POST',
		};
		const fetchResponse = await fetch(baseUrl + '/tweets', {
			method: 'POST',
			headers: {
				...oauth.toHeader(oauth.authorize(oAuthRequest, oauthToken)),
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(postBody),
		});
		return (await fetchResponse.json()) as XV2CreateTweetResponse;
	}

	return {
		createTweet,
	};
}

type FetchDecodedObject = Record<
	string,
	string | number | boolean | string[] | number[] | boolean[]
>;

/**
 * Converts a decoded object to an instance of `URLSearchParams`.
 *
 * `URLSearchParams` are used in `GET` `fetch` requests as query params and
 * `POST` `fetch` requests as the `body` when the `Content-Type` header is set
 * to `application/x-www-form-urlencoded`. The param values must be strings when
 * sent.
 */
function setDecodedObjectAsEncodedUrlSearchParams(
	decodedObject: FetchDecodedObject,
) {
	const result = new URLSearchParams();
	for (const key in decodedObject) {
		const value = decodedObject[key];
		if (Array.isArray(value)) {
			value.forEach((item) => result.append(key, String(item)));
		} else {
			result.set(key, String(value));
		}
	}
	return result;
}
