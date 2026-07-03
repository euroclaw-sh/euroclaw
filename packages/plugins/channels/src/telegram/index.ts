// @euroclaw/channels/telegram — the Telegram provider. `telegram({ token, claw })` is the app's own
// bot (channels plugin); bare `telegram()` is the pure transport for channelConnections. Telegram-
// specific helpers grow here without touching the floor.
export { type TelegramConfig, telegram } from "./channel";
export {
	createTelegramClient,
	type TelegramClient,
	type TelegramFetch,
	type TelegramFetchResponse,
} from "./client";
