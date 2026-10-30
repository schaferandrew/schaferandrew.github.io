---
layout: post
categories: technology
title: Crucible — An AI Task Gauntlet for Local Models
---

Crucible is an AI task gauntlet to analyze whether local models are capable of real work. Can they write code for personal projects, keep working when internet is unavailable, or accomplish tasks involving personal data we don't want to share with cloud providers for training? The tasks are divided into chat and agentic sections and are categorized into three categories of difficulty. Play around, I think you'll be surprised by the performance of these small models.

I am giddy with excitement to introduce **Crucible**. This is my AI workflow gauntlet to help me test models, along with a harness to help me be as efficient as possible with token usage. The local and open-weight world is getting scary good — I'm hopeful this is a tool that helps you see just how capable it is.

## Why is this necessary?

A developer in 2026 is spoiled by an enterprise subscription to Cursor, Codex, or Claude Code. The nearly limitless tokens and polished tool interface begin to create a stark difference between personal projects and company workflows.

Much of the industry is interested in comparing the small differences between Opus 5.5 and Opus 4.6. The brave and curious few might even check out DeepSeek v4.1 or Qwen Flash Next, but largely, we stay in the tools that match our enterprise accounts. That can't last forever. It already doesn't carry over to our personal workflows.

The first signal to this fact is Anthropic themselves. In the latest version of their models, they've found ways to continue to improve performance **and** drop cost for each model family. Companies are already seeking cost savings from their client-facing apps, and eventually they will do the same for their development teams. Like any self-respecting millennial, it's paramount that each decision I make is highly optimized. I wanted to better compare some of the new smaller models with cloud providers to answer the question: **can I do real work with models that run on my hardware?**

Crucible was my answer to this problem. I started thinking of tasks I run each day and built a harness to run them using local LM Studio or OpenRouter for cloud. My goal is to give people the information they need to understand their options. If and when cloud computing prices go up, you run out of tokens, or are on a plane, what work can you expect to do? I hope Crucible can answer these questions.

The tasks are split into three tiers: Spark, Temper, and Forge.

**Spark**: Table stakes. Can it follow basic instructions, reference factual claims with some degree of accuracy, and call tools? It's simple, and on the surface not at the "real work" level, but just months ago, I didn't have any local models that could successfully navigate multiple turns and tool calls in a coding harness like OpenCode.

**Temper**: This is the meat of it. Real work that I turn to my Claude app to do for personal coding projects, but also just helping with some life stuff. I want to know: can I trust it, and by how much?

**Forge**: This is aspirational, however, I will not be surprised when these are all accomplished by smaller models as we continue to optimize performance by the harness and models themselves. For now, it's tasks I'd have to turn to flagship models to run. Large planning tasks, complicated bugs to uncover, and large rewrites.

![Quality vs Time](/assets/img/technology/2026/crucible/chat-quality-vs-time.png)

*Quality vs time — models ranked by score against median latency. Up and to the left is better.*

### What this has helped me do

I've already seen tangible benefits from this workflow:

- **Development & Debugging**: Successfully fixed bugs on my portfolio website and used the harness to quickly recall and run repository-specific commands.
- **Workflow Optimization**: Improved my local dev-ops by configuring LM Studio to better utilize the API via LM Link, optimizing for long-running tasks.
- **Personal Productivity**: Used local models to convert scanned PDFs to ePubs and organize complex household chores and folders.
- **Confidence**: The exercise gave me the confidence to tweak local configurations to squeeze more context and performance out of smaller models.

### How it works

**Testing Philosophy**: Inspired by terminal-bench, focusing on multi-step, goal-oriented interaction tasks that require models to navigate complex environments to reach a specific outcome. Tests are deterministic, progressive (each test builds on the last and gets harder), and normalized to a 1-10 scale for easy comparison.

**Model Categorizations**: Models are grouped by **Execution Environment** (Local via LM Studio/Ollama for privacy, Cloud via OpenRouter for scale), **Tier** (Small, Mid, and Flagship to find the "sweet spot"), and **Quantization & Context** (tracking how bit-depths and context windows affect success rates).

**Architecture**: The harness was built to stay "clean" and support multiple agent interfaces natively — direct, OpenCode, Pi, and the door left open for future agents — while remaining provider-flexible.

![Agentic Leaderboard — Local Only](/assets/img/technology/2026/crucible/agentic-local-leaderboard.png)

*Agentic leaderboard, filtered to local models — gpt-oss-20b leads with a 9.9 Temper score on Whitehall (RTX 5070 Ti).*

### What can you do?

I invite you to take a look at the results, play around with the dashboard, and filter by hardware closest to yours before testing out the models. Give Crucible a shot, run it yourself, and then be bold — try giving it real tasks in the harness of your choice!

Reach out with questions. I hope soon to build the infrastructure to allow community-provided test results, but for now, I'd love to hear what your local models can do.

![Expanded Test Detail](/assets/img/technology/2026/crucible/test-detail.png)

*Each test shows the prompt, scoring rubric, checks, and model output — fully transparent.*

[Check out the Crucible dashboard](/crucible/)
