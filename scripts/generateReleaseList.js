const { Octokit } = require("@octokit/rest");
const semverRsort = require('semver/functions/rsort');
const semver = require('semver');
const fs = require('fs');

const octokit = new Octokit({
    userAgent: 'mattfarina/rd',
    baseUrl: 'https://api.github.com',
});

// octokit.request('GET /rate_limit').then(foo => {
// console.log(foo)
// })
octokit.paginate(octokit.repos.listReleases, {
    owner: 'kubernetes',
    repo: 'kubernetes',
}).then(data => {
    let vers = [];
    data.forEach((val) => {
        // Remove prereleases by looking for a -
        if (!val.tag_name.includes('-') && val.tag_name != undefined) {
            if (semver.valid(semver.coerce(val.tag_name))) {
                if (semver.gte(semver.coerce(val.tag_name), 'v1.13.0')) {
                    vers.push(val.tag_name);
                }
            }
        }
    });

    semverRsort(vers, true);

    try {
        fs.writeFileSync("./src/generated/versions.json", JSON.stringify(vers));
      } catch (err) {
        console.error(err);
      }
});
