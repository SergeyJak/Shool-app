# Call connection guidance

The user confirmed that the laptop's browser permission prompts caused the stalled answer; the eventual call quality was good. Improve the permission-to-call flow in the existing room, without changing media routing.

## Approach
The user explicitly requested an incoming-call popup and a transition into video only after answering. Use a native modal dialog above chat/lesson content, then an inline preparation card instead of a separate mandatory preflight screen. This is an implementation choice: it explains the same steps without adding a second click before every call. A mere error toast would still leave the caller unaware that the other person is granting permissions.

The card explains camera/microphone permissions before capture, shows three stages (access, answer, connection), and keeps pending/error messages away from the video artwork. Requests remain user initiated. The caller sees when the recipient is granting permissions or needs to retry. Only an actual connected peer marks the call connected; remote track discovery or accepting an invitation is insufficient.

## Constraints and validation
Keep existing WebRTC configuration, authentication and invitation semantics. Add only finite preparation states routed to the caller of the current room's unaccepted call. Reject other rooms, spoofed caller IDs, self-notifications, stale calls and post-accept updates. No raw device error text is sent to the other participant. Preserve cancellation and late-media cleanup from PR224. Verify real Socket.IO routing in the existing isolated Mongo fixture, media browser flows, narrow mobile layout, and existing contracts. Publish a draft PR; no merge/deploy.

## Incoming-call interaction
The dialog displays the caller name and Answer / Not now controls. Ringing never requests media or switches the underlying view. Answer closes the dialog, opens the video panel, and requests permissions. Not now and Escape decline while retaining chat; caller cancellation closes the popup. On permission failure the video panel offers retry and cancellation. The popup works even when the video panel is hidden. The successful real call used the direct Railway host; this change does not establish reachability of learning.heysmart.lv from the affected network.
