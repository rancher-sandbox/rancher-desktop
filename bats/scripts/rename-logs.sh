#!/bin/bash
set -o errexit -o nounset -o pipefail

# GitHub restricts artifact filenames:

# Invalid characters include: Double quote ", Colon :, Less than <,
# Greater than >, Vertical bar |, Asterisk *, Question mark ?, Carriage
# return \r, Line feed \n
#
# The following characters are not allowed in files that are uploaded
# due to limitations with certain file systems such as NTFS. To maintain
# file system agnostic behavior, these characters are intentionally not
# allowed to prevent potential problems with downloads on different file
# systems.

if [[ -z ${1:-} ]]; then
    echo "usage: $0 LOGDIR"
    exit 1
fi

# Find all files and put the names into the FILES array.
# We don't rename inside the loop to make sure the find command has
# finished before we modify any directories it is iterating over.
FILES=()
while read -d $'\0' -r FILE; do
    FILES+=("$FILE")
done < <(find "$1" -type f -print0)

# URL-Encode all the forbidden characters
# (bats has already URL-encoded the slash)
for FILE in "${FILES[@]}"; do
    NEW="${FILE//\"/%22}"
    NEW="${NEW//:/%3A}"
    NEW="${NEW//</%3C}"
    NEW="${NEW//>/%3E}"
    NEW="${NEW//|/%7C}"
    NEW="${NEW//\*/%2A}"
    NEW="${NEW//\?/%3F}"
    if [[ $FILE != "$NEW" ]]; then
        echo "$NEW"
        mv "$FILE" "$NEW"
    fi
done
