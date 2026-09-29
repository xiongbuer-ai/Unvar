# Model configuration and networking

English | [简体中文](../zh/network-setup.md)

## Configure a model provider

In **Settings → Model providers**, choose **New provider**. Select OpenAI-compatible, Anthropic or DeepSeek, enter a display name, base URL and model identifier, enable the provider, and save it.

Use the base URL and model identifier specified by your provider or self-hosted service. Enter and save your API key, then choose **Test connection**. This sends a small request to the selected provider and may use its quota.

API keys are stored in the system credential store and are never displayed after saving. You can replace or delete a key. When moving to another device, configure the key separately on that device.

Enter your research focus under **Research context** to help Radar assess relevance to your work.

## What each operation sends

| Operation | Data sent or retrieved |
| --- | --- |
| Save, edit and search captures | Uses the local workspace without automatically calling a model |
| Radar analysis | Retrieves source text and sends it with necessary research context to the selected model |
| Generate a finding candidate | Sends selected experiment records to the model |
| Generate an outline, draft or review | Sends the confirmed Fact Pack and writing content required for that stage |
| Test connection | Sends a small test request to the configured provider |

## Retrieve webpage content

The desktop app retrieves static page content through the system proxy and supports HTML and plain text. It does not execute page scripts or forward application cookies. Pages requiring login, CAPTCHAs or client-side rendering may not yield readable text. In that case, manually save the relevant passages as a note and analyze the note instead.

Retrieval accepts only HTTP(S) URLs without embedded usernames or passwords, follows up to 5 redirects, limits the body to 2 MB, and times out after 20 seconds.

Explicit private IP addresses and obvious local hostnames are rejected. Domain destination IPs are not resolved and validated locally, so domains resolving to private networks are not guaranteed to be blocked. This network mode relies on trusted system proxy and routing settings.

When using a Fake-IP proxy such as Clash Verge, the current desktop retrieval path does not require separate DNS domain exceptions for Unvar.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Cannot select a provider | Make sure it is enabled and its API key has been saved |
| Provider connection fails or returns an HTTP error | Check the base URL, model identifier, key, service quota and network connection |
| Source request fails or times out | Check the URL and whether the system proxy can access it, then retry manually |
| Insufficient readable text | Save the relevant body text as a note, rather than only the page title or navigation |
| Unsupported format or source too large | Use a relevant HTML page or manually capture the text you need |
| Model output fails validation | Check that the source is clear, then retry later or use another model; invalid output is not saved as a valid result |
| Cannot save a key | Check access permissions for the device's system credential store |

Workspace synchronization does not transfer keys. See [Workspaces and synchronization](workspace-folders.md).

## Jev through OpenRouter

Open Settings → **Jev / OpenRouter**. Save an OpenRouter API key in the dedicated field, keep `typesafe/jev-1.13` or enter another supported explicit Jev version, then test the connection. This makes a real, potentially billable System One request. The generation provider and its key remain separate.

Enable Jev and save settings to use it for new Radar question scores. Existing questions have **Rescore with Jev** and **Scoring provenance** controls. History shows the actual model, source input, scores, original answers, usage and elapsed time. Failed Jev calls are explicitly labeled **Rules fallback**; they are not successful Jev results. Human overrides remain in force. Canceling a score does not start a fallback request.

Pi uses the same scoring service when its restricted `score_question` tool is selected. Its scores are proposals and do not accept Findings or confirm Fact Packs. With Jev disabled, ordinary Radar keeps its generation-model scoring and Pi can return a clearly labeled Rules proposal. Delete the Jev key to remove that credential and disable Jev. Restart the app after a development update that changes main/preload interfaces.
