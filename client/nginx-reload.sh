#!/bin/sh
# Run by the nginx image's entrypoint before nginx starts: reload every 6 hours so renewed
# certificates are picked up.
(while :; do sleep 6h; nginx -s reload; done) >/dev/null 2>&1 &
