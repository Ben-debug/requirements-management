import re

with open('public/js/app.js', 'r') as f:
    content = f.read()

# Replace projTag line (meeting view schedule card)
old = "const projTag = s.is_project ? `<span class=\"sched-tag\">\U0001f4cb ${esc(s.project_code||'')} ${esc(s.project_name||'')}</span>` : '';"
new = "const projTag = s.is_project ? '<span class=\"sched-tag\">\U0001f4cb 已立项</span>' : '';"
content = content.replace(old, new)

old2 = "const projTag2 = s.is_project ? `<span class=\"sched-tag\">\U0001f4cb ${esc(s.project_code||'')} ${esc(s.project_name||'')}</span>` : '';"
new2 = "const projTag2 = s.is_project ? '<span class=\"sched-tag\">\U0001f4cb 已立项</span>' : '';"
content = content.replace(old2, new2)

with open('public/js/app.js', 'w') as f:
    f.write(content)
print('app.js schedule cards cleaned')
