# ai1.stats

Measures every [ai1](../ai1/) call (`ai1:call`) per model at a provider, in `ai1_model_provider_stat`:
calls, errors, usage (as the provider counts: tokens, characters, seconds) and the time of the
successful ones with output tokens. Failed calls are logged in `ai1_call_error`.

The measured speed goes into `ai1_model_provider.speed` hourly, so ai1 chooses by it: once a model
at a provider has answered for 10 s in all, its own measurement counts, before that a benchmark's
speed (score `tokens_per_second`). The counts halve daily, so what happens now outweighs the past;
the usage stays a total.
