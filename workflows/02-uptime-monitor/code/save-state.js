// Persist the state computed by "Evaluate". Runs after the alert email (if any) was sent,
// so a failed email means the change is reported again on the next run.
const { newState } = $('Evaluate').first().json;
$getWorkflowStaticData('global').uptime = newState && typeof newState === 'object' ? newState : {};
return [{ json: { saved: Object.keys(newState ?? {}).length } }];
