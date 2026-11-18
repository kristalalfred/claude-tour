---
name: code-tour
description: Show how code works as a guided tour in a pane, with a journey graph, a file tree and highlighted code for each step. Use when the person asks how something works across several places in the code, such as "how does X end up in the database", "walk me through the request path", "what happens when I click Y", or asks for a tour, walkthrough or tutorial of a flow. Not for a question one excerpt answers.
---

# Tour

A tour answers a "how does this work" question by walking the person along the path the code takes, one stop at a time. The `mcp__tour__show` tool opens it in a pane: a journey graph of the stops, a file tree of the files involved, and a code viewer that highlights each stop's lines beside a note that explains them. The person steps through it at their own pace.

## Research first

Trace the real path before writing anything. Find the entry point (a route, handler, command, event or component) and follow the calls with Grep, Read and LSP until the effect the person asked about (a row written, a request sent, a value rendered). Read every excerpt with line numbers so each range is exact. Do not guess a range or a call you have not read.

## Choose the stops

- Use three to eight stops in the order control or data flows.
- A stop is a place where something happens that the person needs to understand: the entry, validation, a transformation, a decision, the persistence or the side effect.
- Leave out wrappers that only pass things along, and name them in the next note instead ("`withTx` only opens the transaction around this").
- Follow the main path. Mention a branch in the note where it splits, or offer a second tour for it.

## Write each step

- `title`: the node in the journey graph, one to four words, usually the function or component (`OrderService.place`).
- `file`: relative to the working directory.
- `lines`: the enclosing function or block, with a little context. Keep it short enough to read in one view, about 40 lines at most.
- `highlight`: the few lines the note talks about, usually one to three contiguous runs, so the eye lands on them. Leave it out only when the whole range matters.
- `note`: two to six sentences of Markdown. Say what happens here and why, the data as it comes in and goes out (its shape and names), and how it hands off to the next stop. Refer to the highlighted code by what it does, not by line numbers. Use `code` spans for names. Explain anything surprising: a constraint, a side effect, a place it can fail.

The `title` of the tour is the question it answers as a headline: "How an order reaches the database".

## After calling

- When the tool reports problems, fix the named steps and call it again.
- When it says the terminal is too narrow to open the pane, tell the person to run `/tour`.
- Once the tour is open, reply in one or two sentences with the gist of the answer, so the chat stands on its own. Do not repeat the notes.
- Follow-up prompts carry the step the person is looking at. Answer about that step, and open a new tour when they want to go deeper into one part.
