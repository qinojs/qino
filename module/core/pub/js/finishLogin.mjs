// A login waiting for a second factor: ask what is missing, open the step-up dialog, reload.
import { api } from "./api.js";
import { stepUp } from "./stepUpDialog.js";

const { factors } = await api.core.login.missing.get();
if (factors.length && await stepUp({ factors })) location.reload();
