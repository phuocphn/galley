# A Review's URL is derived from its folder

Now that the Desk holds several Reviews (ADR 0008), each needs a name in its URL. That name is computed from the folder's path — its basename, slugged, plus four hex characters of a hash of the resolved path:

```
/Users/me/launch-copy   →   /r/launch-copy-a1b2
```

It is never assigned. The same folder gets the same URL from every Desk, on every machine, forever, which is what makes it something a reviewer can bookmark and recognise.

## Considered Options

- **An id assigned when the Review opens** — a UUID, or a counter. Simplest to write and collision-free by construction. Rejected because the URL then means nothing outside the process that minted it: restart the Desk and every open tab is pointing at a Review that no longer exists, with no way to work out what it was.
- **The basename alone, disambiguated on collision** — `/r/launch-copy`, with a second folder of the same name becoming `/r/launch-copy-2`. The prettiest URL. Rejected because the suffix depends on what was open when: `/r/out-2` is a different folder depending on the order the reviewer opened things. That breaks the guarantee exactly when several Reviews are open, which is the case this whole design is for.
- **The hash alone** — `/r/a1b2c3d4`. Stable and unique. Rejected on reading: with four tabs open, none of them says which folder it is.
- **The encoded absolute path** — `/r/%2FUsers%2Fme%2Flaunch-copy`. Perfectly stable, and reversible, which would remove the need to remember anything. Rejected because it puts the reviewer's home directory layout into a URL that gets pasted into issues and screenshots.

## Consequences

- **A bookmark survives the Desk.** Because the id is derived, the Review it names is the same one tomorrow. `tests/desk.test.ts` asserts this across two Desks, which is the executable form of this decision.
- **The id cannot be read backwards**, so the Desk writes down what each one meant, in `reviews.json` under `GALLEY_HOME`. Visiting a Review the Desk has closed reopens it from there; that file exists only because of the choice made here. It is a registry and never a liveness record — what is *running* is asked of the running Desk, which cannot be wrong.
- **Symlinks are resolved before hashing**, so two paths to one folder are one Review rather than two views fighting over one sidecar.
- **Moving or renaming the folder gives a new URL**, and the old bookmark stops working. That is the intended reading: it is a different Review. Nothing follows the folder, and the registry drops entries whose folder has gone.
- **A folder whose name slugs away to nothing** — `...`, or a name in a script with no ASCII — still gets a working id, because the hash carries the identity and the slug is only there to be read.
