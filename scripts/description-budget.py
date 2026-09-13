s = open("/home/cryptonomist/stockduel/docs/submission.md", encoding="utf-8").read()
i = s.find("## Long description")
j = s.find("## Against the four things")
raw = s[s.find("\n", i) + 1 : j].strip()

# The blockquote is a note to ourselves, not part of what gets pasted.
body = "\n".join(l for l in raw.split("\n") if not l.lstrip().startswith(">")).strip()

print("Full Description body: %d chars of 5000  (%+d)" % (len(body), len(body) - 5000))
print()
for para in body.split("\n\n"):
    if not para.strip():
        continue
    print("  %5d  %s" % (len(para), para.strip().split("\n")[0][:56]))
