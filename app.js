const patients = [
  {id:1, initials:"AM", name:"Alain M.", mrn:"HC-100241", unin:"243-10L-M192-00003", dob:"12 Mar 1992", sex:"Male", type:"Outpatient", service:"Cardiology", provider:"Assigned provider", status:"Open", time:"08:30"},
  {id:2, initials:"CK", name:"Chantal K.", mrn:"HC-100242", unin:"Not assigned", dob:"28 Jun 1985", sex:"Female", type:"Inpatient", service:"Medicine", provider:"Assigned provider", status:"Open", time:"09:15"},
  {id:3, initials:"JM", name:"Joseph M.", mrn:"HC-100243", unin:"Not assigned", dob:"03 Nov 1976", sex:"Male", type:"ED", service:"Emergency", provider:"Assigned provider", status:"Closed", time:"10:00"},
  {id:4, initials:"SN", name:"Sarah N.", mrn:"HC-100244", unin:"Not assigned", dob:"17 Jan 2001", sex:"Female", type:"Outpatient", service:"Neurology", provider:"Assigned provider", status:"Open", time:"11:30"}
].map(patient => ({...patient, provider: "Assigned provider"}));

const navItems = [
  ["dashboard","▦","Overview"],["patients","♙","Patients"],["chart","▤","Patient chart"],
  ["encounters","⌁","Encounters"],["orders","☷","Orders & results"],["medications","✚","Medications"],
  ["notes","▣","Clinical notes"],["registry","◎","UNIN registry"],["departments","◇","Departments"],
  ["access","⚿","Access control"],["audit","◷","Audit trail"]
];

const departments = [
  ["Emergency & Critical Care",["Emergency Department","Trauma Center","Adult ICU","Cardiac ICU","Neuro ICU","Burn Unit"]],
  ["Surgery",["General Surgery","Cardiothoracic Surgery","Orthopedic Surgery","Neurosurgery","Transplant Surgery","Pre-Op / PACU"]],
  ["Medicine",["Internal Medicine","Cardiology","Pulmonology","Gastroenterology","Nephrology","Endocrinology"]],
  ["Cancer Center",["Medical Oncology","Radiation Oncology","Surgical Oncology","Infusion Center","Bone Marrow Transplant"]],
  ["Women’s Health",["Obstetrics","Gynecology","Maternal-Fetal Medicine"]],
  ["Pediatrics",["General Pediatrics","PICU","NICU","Pediatric Subspecialties"]],
  ["Behavioral Health",["Psychiatry","Psychology","Addiction Services"]],
  ["Rehabilitation",["Physical Therapy","Occupational Therapy","Speech Therapy","Cardiac Rehab","Stroke Rehab"]],
  ["Radiology & Imaging",["X-ray","CT","MRI","Ultrasound","Interventional Radiology","Mammography"]],
  ["Laboratory & Pathology",["Core Lab","Microbiology","Blood Bank","Anatomic Pathology"]],
  ["Pharmacy",["Inpatient Pharmacy","Outpatient Pharmacy","Clinical Pharmacy"]],
  ["Support Services",["Admissions & Registration","Medical Records","Billing & Insurance","Case Management","IT & Informatics","Quality & Safety"]]
];

const roles = [
  ["Attending Physician","full","full","full","full","none","none","none","limited"],
  ["Nurse (RN/LPN)","full","full","limited","none","none","none","none","limited"],
  ["Pharmacist","full","limited","limited","limited","none","none","none","limited"],
  ["Lab Tech","full","limited","limited","none","none","none","none","none"],
  ["Registration / Front Desk","full","none","limited","none","limited","none","none","none"],
  ["Billing / Coder","full","limited","none","none","full","none","none","limited"],
  ["HIM / Medical Records","full","full","none","none","none","none","none","full"],
  ["System Admin","limited","limited","limited","none","none","full","full","full"],
  ["Patient (Portal)","limited","limited","limited","none","limited","none","none","none"]
];

let active = "dashboard";
let selectedPatient = patients[0];

const view = document.querySelector("#view");
const nav = document.querySelector("#primary-nav");
const esc = (value) => String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const status = value => `<span class="status ${value.toLowerCase()}">${esc(value)}</span>`;
const head = (eyebrow,title,subtitle,action="") => `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
const patientRows = list => list.map(p => `<tr data-patient="${p.id}"><td><div class="patient-cell"><span class="patient-avatar">${p.initials}</span><span><strong>${p.name}</strong><small>${p.mrn}</small></span></div></td><td>${p.dob}</td><td>${p.service}</td><td>${p.provider}</td><td>${status(p.status)}</td><td>${p.time}</td></tr>`).join("");

function renderNav(){
  nav.innerHTML = navItems.map(([id,icon,label]) => `<button class="nav-button ${id===active?"active":""}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join("");
}

function dashboard(){return `${head("Clinical workspace","Good morning, Dr. Doe","Wednesday, 26 August 2026 · Internal EHR · Demonstration data",`<button class="button primary" data-action="new-patient">＋ Register patient</button>`)}
  <section class="metrics">
    ${[["Today’s encounters","24","4 waiting","⌁"],["Open orders","18","6 need review","☷"],["New results","12","3 abnormal flags","↗"],["Active patients","1,248","Registry-linked records","♙"]].map(m=>`<article class="metric"><div class="metric-top"><span class="metric-label">${m[0]}</span><span class="metric-icon">${m[3]}</span></div><strong>${m[1]}</strong><small>${m[2]}</small></article>`).join("")}
  </section>
  <section class="grid-2">
    <article class="card"><header class="card-head"><h2>Today’s schedule</h2><button class="button ghost" data-view="encounters">View encounters</button></header><div class="table-wrap"><table><thead><tr><th>Patient</th><th>Date of birth</th><th>Service</th><th>Provider</th><th>Status</th><th>Time</th></tr></thead><tbody>${patientRows(patients)}</tbody></table></div></article>
    <div class="card"><header class="card-head"><h2>Recent clinical activity</h2><span>Audited events</span></header><div class="card-body activity-list">
      ${[["☷","Lab result finalized","CBC result for Alain M. marked final.","8 minutes ago"],["✚","Medication verified","Medication order reviewed by pharmacy.","22 minutes ago"],["▣","Progress note signed","Signed by assigned provider.","41 minutes ago"],["⌁","Encounter opened","Outpatient Cardiology encounter.","1 hour ago"]].map(a=>`<div class="activity"><span class="activity-icon">${a[0]}</span><div><strong>${a[1]}</strong><p>${a[2]}</p><time>${a[3]}</time></div></div>`).join("")}
    </div></div>
  </section>
  <section class="card" style="margin-top:18px"><header class="card-head"><h2>Quick actions</h2><span>Role-scoped for Attending Physician</span></header><div class="card-body quick-actions">
    ${[["♙","Find a patient","patients"],["⌁","Open encounter","encounters"],["☷","Place an order","orders"],["▣","Write a note","notes"]].map(q=>`<button class="quick" data-view="${q[2]}"><span>${q[0]}</span><strong>${q[1]}</strong></button>`).join("")}
  </div></section>`}

function patientsView(){return `${head("Patient administration","Patients","Search demographics, MRN, or UNIN. Access is role-controlled and audited.",`<button class="button primary" data-action="new-patient">＋ Register patient</button>`)}
  <div class="filter-bar"><input id="patient-filter" placeholder="Filter visible demonstration records…"><select><option>All services</option><option>Cardiology</option><option>Medicine</option></select><select><option>All statuses</option><option>Open</option><option>Closed</option></select></div>
  <article class="card"><div class="table-wrap"><table><thead><tr><th>Patient</th><th>Date of birth</th><th>Service</th><th>Provider</th><th>Status</th><th>Time</th></tr></thead><tbody id="patient-table">${patientRows(patients)}</tbody></table></div></article>`}

function chart(){const p=selectedPatient;return `${head("Longitudinal record","Patient chart","Clinical chart for the selected demonstration record.",`<button class="button secondary" data-action="print-summary">Print summary</button>`)}
  <section class="patient-hero"><div class="patient-id"><span class="hero-avatar">${p.initials}</span><div><h2>${p.name}</h2><p>${p.mrn} · ${p.dob} · ${p.sex}</p></div></div><div class="patient-facts"><div><small>UNIN / SNAU</small><strong>${p.unin}</strong></div><div><small>Current service</small><strong>${p.service}</strong></div><div><small>Encounter</small><strong>${p.status}</strong></div></div></section>
  <div class="tabs">${["Summary","Encounters","Orders & results","Medications","Notes","Demographics"].map((t,i)=>`<button class="tab ${i===0?"active":""}" data-tab="${t}">${t}</button>`).join("")}</div>
  <section class="clinical-grid"><div class="card"><header class="card-head"><h2>Clinical summary</h2><span>Last updated today</span></header><div class="card-body"><h3 class="section-title">Encounter</h3><div class="data-list"><div class="data-row"><span>Type</span><strong>${p.type}</strong></div><div class="data-row"><span>Service</span><strong>${p.service}</strong></div><div class="data-row"><span>Attending provider</span><strong>${p.provider}</strong></div><div class="data-row"><span>Status</span>${status(p.status)}</div></div><h3 class="section-title" style="margin-top:20px">Recent result</h3><div class="alert"><strong>Demonstration only:</strong> No clinical result values were supplied in the source documents. The application preserves the results workflow without inventing patient findings.</div></div></div>
  <div class="card"><header class="card-head"><h2>Record modules</h2><button class="button ghost" data-view="orders">Open all</button></header><div class="card-body data-list">${[["Active medication orders","0"],["Pending orders","0"],["Final results","0"],["Signed notes","0"]].map(x=>`<div class="data-row"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join("")}</div></div></section>`}

function encounters(){return moduleList("Encounter management","Encounters","Visits, admissions, emergency episodes, and observation records.",[["Outpatient · Cardiology","Alain M. · 08:30","Open"],["Inpatient · Medicine","Chantal K. · 09:15","Open"],["Emergency","Joseph M. · 10:00","Closed"]],["Encounter","Patient / time","Status"])}
function orders(){return moduleList("Clinical workflow","Orders & results","Laboratory, imaging, procedure, and medication order workflows.",[["Laboratory · CBC","Alain M. · Routine","Final"],["Imaging · MRI","Sarah N. · Routine","Pending"],["Procedure · Consultation","Chantal K. · Scheduled","Open"]],["Order","Patient / priority","Status"],"Place order")}
function medications(){return moduleList("Medication management","Medications","Medication catalog, prescriptions, verification, and administration record.",[["Medication catalog","Name, generic name, strength, form, route","Active"],["Medication orders","Dose, route, frequency, dates","Open"],["Administration record","Administered time, provider, dose, notes","Open"]],["Module","Documented fields","Status"],"New medication order")}
function notes(){return moduleList("Clinical documentation","Clinical notes","Progress, consult, discharge, operative, and nursing notes.",[["Progress note","Draft · Assigned provider","Pending"],["Consult note","Signed · Cardiology","Signed"],["Discharge note","Signed · Medicine","Signed"]],["Note type","Author / state","Status"],"Write note")}
function audit(){return moduleList("Accountability","Audit trail","Every chart view and change is logged with actor, action, time, and context.",[["VIEW · Patient chart","Signed-in user · Clinical EHR","Final"],["UPDATE · Clinical note","Signed-in user · Clinical EHR","Final"],["VIEW · UNIN validation","Registry service · API","Final"]],["Action","Actor / context","Logged"],null)}

function moduleList(eyebrow,title,subtitle,rows,headers,action){return `${head(eyebrow,title,subtitle,action?`<button class="button primary" data-action="module-create">＋ ${action}</button>`:"")}<article class="card"><div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>`<td>${i===2?status(c):c}</td>`).join("")}</tr>`).join("")}</tbody></table></div></article><div class="alert" style="margin-top:14px"><strong>Prototype boundary:</strong> Visible records are demonstration data. The supplied documents define workflow fields and access patterns, not live patient content.</div>`}

function registry(){return `${head("Identity interoperability","UNIN registry","Unique National Identity Number / SNAU workflows, family links, and validation.",`<button class="button primary" data-action="enroll">＋ Start enrollment</button>`)}
  <section class="registry-banner"><div><h2>National registry linkage</h2><p>The UNIN/SNAU is the stable join key between the registry, EHR, Healthcarology portals, and authorized sector systems.</p></div><div class="unin-code">243-PPCC-SXYYY-CTUUUU</div></section>
  <section class="steps">${[["01","Enroll","Capture civil data, birthplace, sex, and category."],["02","Generate","Create identifier from country, province, commune, sex, birth year, category, sequence."],["03","Verify","Check uniqueness by identifier and civil attributes."],["04","Audit","Record create, update, view, and logical delete actions."]].map(s=>`<article class="card step"><span class="step-number">${s[0]}</span><h3>${s[1]}</h3><p>${s[2]}</p></article>`).join("")}</section>
  <section class="grid-2" style="margin-top:18px"><article class="card"><header class="card-head"><h2>Validate an identifier</h2><span>Documented DRC pattern</span></header><div class="card-body"><div class="filter-bar"><input id="unin-input" value="243-10L-M192-00003" aria-label="UNIN to validate"><button class="button primary" data-action="validate-unin">Validate</button></div><div id="unin-result" class="alert">Enter the supplied example or another identifier matching the documented format.</div></div></article><article class="card"><header class="card-head"><h2>Registry entities</h2></header><div class="card-body data-list">${[["Person","Identity, birthplace, category, life status"],["Family links","Main person, dependent, relationship"],["Reference tables","Province, commune/sector, category"],["Audit log","Action, actor, time, context"]].map(r=>`<div class="data-row"><strong>${r[0]}</strong><span>${r[1]}</span></div>`).join("")}</div></article></section>`}

function departmentsView(){return `${head("Organization","Departments & services","The compact integration structure supplied for Healthcarology.","")}<section class="department-grid">${departments.map((d,i)=>`<article class="card department-card"><header><h3>${d[0]}</h3><span class="status active">${d[1].length} services</span></header><ul>${d[1].map(s=>`<li>${s}</li>`).join("")}</ul></article>`).join("")}</section>`}

function access(){const icon={full:"✓",limited:"◆",none:"—"};return `${head("Role-based access","Access control","Least privilege, need-to-know, MFA, and audited access.",`<button class="button secondary" data-action="review-access">Review access</button>`)}<article class="card"><div class="table-wrap"><table><thead><tr><th>Role</th>${["Demographics","Clinical","Edit clinical","Order / prescribe","Billing","Admin users","System config","Audit logs"].map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${roles.map(r=>`<tr><td><strong>${r[0]}</strong></td>${r.slice(1).map(v=>`<td class="permission ${v}" title="${v}">${icon[v]}</td>`).join("")}</tr>`).join("")}</tbody></table></div></article><div class="alert" style="margin-top:14px"><strong>Legend:</strong> ✓ full access · ◆ limited or scoped access · — no access. Exact qualifiers remain in the source requirements and database policy comments.</div>`}

function render(){
  renderNav();
  const routes={dashboard,patients:patientsView,chart,encounters,orders,medications,notes,registry,departments:departmentsView,access,audit};
  view.innerHTML=routes[active]();
  bindView();
  document.querySelector(".sidebar").classList.remove("open");
  window.scrollTo({top:0,behavior:"smooth"});
}

function toast(message){const el=document.querySelector("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
function setView(id){if(navItems.some(x=>x[0]===id)){active=id;render()}}

function bindView(){
  view.querySelectorAll("[data-view]").forEach(el=>el.addEventListener("click",()=>setView(el.dataset.view)));
  view.querySelectorAll("[data-patient]").forEach(el=>el.addEventListener("click",()=>{selectedPatient=patients.find(p=>p.id===Number(el.dataset.patient));setView("chart")}));
  const filter=view.querySelector("#patient-filter"); if(filter) filter.addEventListener("input",e=>{const q=e.target.value.toLowerCase();view.querySelector("#patient-table").innerHTML=patientRows(patients.filter(p=>`${p.name} ${p.mrn} ${p.unin}`.toLowerCase().includes(q)))||`<tr><td colspan="6" class="empty">No matching demonstration record</td></tr>`;bindView()});
  view.querySelectorAll("[data-action]").forEach(el=>el.addEventListener("click",()=>{
    if(el.dataset.action==="validate-unin"){
      const value=view.querySelector("#unin-input").value.trim();
      const ok=/^243-\d{2}[A-Z]-[MF]\d{3}-[A-Z0-2]\d{4}$/.test(value);
      view.querySelector("#unin-result").innerHTML=ok?`<strong>Format valid.</strong> ${esc(value)} matches the documented DRC example pattern. This does not confirm registry uniqueness.`:`<strong>Format not valid.</strong> This value does not match the documented DRC example pattern.`;
    } else toast("Prototype action — persistence requires a connected Supabase project.");
  }));
}

nav.addEventListener("click",e=>{const button=e.target.closest("[data-view]");if(button)setView(button.dataset.view)});
document.querySelector("#mobile-menu").addEventListener("click",()=>document.querySelector(".sidebar").classList.toggle("open"));
document.querySelector("#global-search").addEventListener("keydown",e=>{if(e.key==="Enter"){const q=e.target.value.toLowerCase();const match=patients.find(p=>`${p.name} ${p.mrn} ${p.unin}`.toLowerCase().includes(q));if(match){selectedPatient=match;setView("chart")}else toast("No matching demonstration record")}});
render();

export { patients, departments, roles };
