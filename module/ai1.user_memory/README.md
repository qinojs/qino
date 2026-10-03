# ai1.user_memory

**A prototype** using ai1.agent hooks and `decide()` to sort memories: which are the user's,
which the agent's.

What agents keep about a user: their language, how to address them, their preferences. It is theirs
with every agent, and only in their own sessions.

Hooked into [ai1.agent](../ai1.agent/), so it can be left out or replaced by another module:

- `ai1.agent:turn`: who the user is (name, email, id) and the strongest 10 of what is known about them go into the
  context as the session starts ("## User", ids as `u5`), and the tool to forget it. To change one, the agent forgets it and remembers
  the new one: `decide()` sorts every new memory.
- `ai1.agent:associate`: what the user says strengthens their memories close to it.
- `ai1.agent:remember`: a new memory is theirs if it is about them, as a quick `decide()` judges;
  else it stays the agent's.

The user sees and changes their memories at `api/ai1.user_memory/memories`.
