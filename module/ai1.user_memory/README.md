# ai1.user_memory

**A prototype**, to see how the hooks of ai1.agent work, and how a quick `decide()` (Jev) does at
sorting memories: which are the user's, which the agent's.

What agents keep about a user: their language, how to address them, their preferences. It is theirs
with every agent, and only in their own sessions.

Hooked into [ai1.agent](../ai1.agent/), so it can be left out or replaced by another module:

- `ai1.agent:turn`: what is known about the user goes into the context ("About the user you talk
  with", ids as `u5`), and the tool to forget it. To change one, the agent forgets it and remembers
  the new one: `decide()` sorts every new memory.
- `ai1.agent:remember`: a new memory is theirs if it is about them, as a quick `decide()` judges;
  else it stays the agent's.

The user sees and changes their memories at `api/ai1.user_memory/memories`.
