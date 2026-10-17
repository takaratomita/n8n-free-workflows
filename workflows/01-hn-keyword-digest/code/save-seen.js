// Runs only after the digest email was sent: remember which stories went out.
const { newSeen } = $('Pick New Stories').first().json;
$getWorkflowStaticData('global').hnSeen = Array.isArray(newSeen) ? newSeen : [];
return [{ json: { saved: Array.isArray(newSeen) ? newSeen.length : 0 } }];
