# ai.stats

Measures every [ai](../ai/) call (`ai:call`) per model at a provider, in `ai_model_provider_stat`:
calls, errors, usage (as the provider counts: tokens, characters, seconds) and the time of the
successful ones with output tokens. Failed calls are logged in `ai_call_error`.

The measured speed goes into `ai_model_provider.speed` hourly, so ai chooses by it: once a model
at a provider has answered for 10 s in all, its own measurement counts, before that a benchmark's
speed (score `tokens_per_second`). The counts halve daily, so what happens now outweighs the past;
the usage stays a total.
