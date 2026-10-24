# Check indexing and IndexNow

Use the public site to check output and the plugin's submission history to
check delivery. Search engines decide whether and when to crawl or index a
submitted page.

## Check public files

Open these paths on your production origin without an admin session:

| Path | Check |
| --- | --- |
| `/sitemap.xml` | HTTP 200, XML, and only the intended public canonical URLs |
| `/robots.txt` | HTTP 200, the intended crawl rules and the correct sitemap address |
| `/llms.txt` | HTTP 200 and the saved document when output is enabled |
| `/indexnow-key.txt` | HTTP 200 and the exact verification key before enabling IndexNow |

A sitemap can be a flat URL list or an index linking to child files. Inspect
the served XML and follow only the child files it actually lists. A missing
child filename does not make a flat sitemap invalid. Open each listed page
and check its response, canonical URL and robots directives separately.

A sitemap entry, an Index choice or an IndexNow response does not guarantee
indexing. Sitemap exclusions also do not restrict access or add noindex.

### Static frontends

A static frontend must include its public files in the deployed artifact.
Changing a setting in a separate CMS does not replace those deployed files;
regenerate and deploy the affected output. Keep the public site's sitemap
and IndexNow key at the production origin configured in the plugin.

Automatic IndexNow delivery follows CMS events and does not wait for a static
deployment to finish. Coordinate publication and deployment so submitted
addresses are available publicly. The CMS runtime must remain running to
process its queue.

## Enable IndexNow

Set the website's public HTTPS root origin in the plugin's website settings
and the host configuration. A custom port is not supported. Then open
**SHIPIT SEO > Indexing > IndexNow** and select **Enable IndexNow**.

With the plugin-owned key route, this action creates a key, serves its file,
checks it at the public address and turns delivery on. No key needs to be
copied. If an Astro site already serves the default `/indexnow-key.txt` file,
first setup can read and reuse its valid key in one request when no key has
been configured and IndexNow has never been activated. **Try again** can finish
this automatic setup after a failed check.

Setup preserves manually configured keys, custom key locations and keys from
a previous activation. It does not overwrite site-owned files. The key is
public proof that you control the site; it is not an account password or API
credential.

The public check requires HTTP 200, `text/plain`, and one valid UTF-8 key
matching the saved setting. The file must be served directly without a
redirect, sign-in or browser challenge. A failed first setup leaves delivery
off and shows the failed step.

| Failure | What to check |
| --- | --- |
| HTTP 403 | Check access or firewall rules for the exact public key-file path. The verifier must be able to read it without an admin session. |
| HTTP 404 | Confirm that the deployed site serves the configured file through the Astro integration or its existing public route. |
| Redirect | Serve the file directly at the configured address. |
| Invalid response | Return only the key as UTF-8 plain text, no larger than 256 bytes. An HTML error or challenge page is not a key file. |
| Mismatched key | Compare the saved key with the existing file and deliberately choose which to retain. Setup will not replace either to resolve a mismatch. |
| Timeout or unreachable file | Check the production origin and the host's outbound network access before trying again. |

Correct the reported problem, then select **Try again**. Automatic submission
remains a separate control; first setup does not turn it on.

## Review submission history

1. Open **SHIPIT SEO > Indexing > IndexNow > Submission history**.
2. Check **Last attempt**, **Status** and **HTTP result**. Expand a batch to
   inspect its exact URLs; **Manual list** identifies an explicit submission.
3. Use **Refresh** to read the latest stored results. It does not submit
   another request.

| Result | Meaning |
| --- | --- |
| Queued, no attempt yet | No provider response has been recorded |
| Sent, HTTP 200 | IndexNow received the request successfully |
| Accepted, HTTP 202 | The request was accepted while key validation is pending |
| Failed or retry scheduled | Inspect the recorded response and configuration before another deliberate action |

Neither Sent nor Accepted confirms crawling or indexing. A timeout can leave
delivery uncertain: the provider may have received the request even when the
plugin did not receive its response.

## Enable automatic submission deliberately

Enabling IndexNow verifies the public key and enables delivery. Automatic
submission is a separate control with its own saved content-type selection.
Turning it on does not submit every existing page. Use a manual list when you
intend to notify engines about existing public URLs.

Keep the batch size, attempt limit and resend interval appropriate for your
site. Turning delivery off preserves its key, queue and history; already
dispatched requests may finish. Review retained work before enabling it again.

See [compatibility and verification coverage](compatibility.md#beta-verification-coverage)
for completed checks and remaining limits.
