import {forbidden,badRequest} from '../utils/httpError.js';
import {requireUuid} from '../validators/simple.js';
import {getFamilyPlanAccess} from './planAccess.js';
import {schoolSession} from './schoolSession.js';
export async function widgetSchoolAction(access,body={},now=new Date()){
 if(!access.school_actions||!['owner','parent','carer'].includes(access.role))throw forbidden('Open FamilyTrack to enable school actions.');
 if(!['start','end'].includes(body.action))throw badRequest('Unknown school action.');
 const childId=requireUuid(body.childId,'Care profile');
 const plan=await getFamilyPlanAccess(access.family_id);
 if(!(body.action==='start'?plan.canAddLogs:plan.canEditLogs))throw forbidden('This account is view-only.');
 return schoolSession(access.family_id,childId,access.user_id,body,now,{widget:true});
}
