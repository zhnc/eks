"use strict";
const cfnResponse = require("./cfn-response");
const consts = require("./consts");
const outbound_1 = require("./outbound");
const util_1 = require("./util");
/**
 * The main runtime entrypoint of the async custom resource lambda function.
 *
 * Any lifecycle event changes to the custom resources will invoke this handler, which will, in turn,
 * interact with the user-defined `onEvent` and `isComplete` handlers.
 *
 * This function will always succeed. If an error occurs
 *
 * @param cfnRequest The cloudformation custom resource event.
 */
async function onEvent(cfnRequest) {
    util_1.log('onEventHandler', cfnRequest);
    cfnRequest.ResourceProperties = cfnRequest.ResourceProperties || {};
    const onEventResult = await invokeUserFunction(consts.USER_ON_EVENT_FUNCTION_ARN_ENV, cfnRequest);
    util_1.log('onEvent returned:', onEventResult);
    // merge the request and the result from onEvent to form the complete resource event
    // this also performs validation.
    const resourceEvent = createResponseEvent(cfnRequest, onEventResult);
    util_1.log('event:', onEventResult);
    // determine if this is an async provider based on whether we have an isComplete handler defined.
    // if it is not defined, then we are basically ready to return a positive response.
    if (!process.env[consts.USER_IS_COMPLETE_FUNCTION_ARN_ENV]) {
        return await cfnResponse.submitResponse('SUCCESS', resourceEvent);
    }
    // ok, we are not complete, so kick off the waiter workflow
    const waiter = {
        stateMachineArn: util_1.getEnv(consts.WAITER_STATE_MACHINE_ARN_ENV),
        name: resourceEvent.RequestId,
        input: JSON.stringify(resourceEvent),
    };
    util_1.log('starting waiter', waiter);
    // kick off waiter state machine
    await outbound_1.startExecution(waiter);
}
// invoked a few times until `complete` is true or until it times out.
async function isComplete(event) {
    util_1.log('isComplete', event);
    const isCompleteResult = await invokeUserFunction(consts.USER_IS_COMPLETE_FUNCTION_ARN_ENV, event);
    util_1.log('user isComplete returned:', isCompleteResult);
    // if we are not complete, reeturn false, and don't send a response back.
    if (!isCompleteResult.IsComplete) {
        if (isCompleteResult.Data && Object.keys(isCompleteResult.Data).length > 0) {
            throw new Error('"Data" is not allowed if "IsComplete" is "False"');
        }
        throw new cfnResponse.Retry(JSON.stringify(event));
    }
    const response = {
        ...event,
        Data: {
            ...event.Data,
            ...isCompleteResult.Data,
        },
    };
    await cfnResponse.submitResponse('SUCCESS', response);
}
// invoked when completion retries are exhaused.
async function onTimeout(timeoutEvent) {
    util_1.log('timeoutHandler', timeoutEvent);
    const isCompleteRequest = JSON.parse(JSON.parse(timeoutEvent.Cause).errorMessage);
    await cfnResponse.submitResponse('FAILED', isCompleteRequest, {
        reason: 'Operation timed out',
    });
}
async function invokeUserFunction(functionArnEnv, payload) {
    const functionArn = util_1.getEnv(functionArnEnv);
    util_1.log(`executing user function ${functionArn} with payload`, payload);
    // transient errors such as timeouts, throttling errors (429), and other
    // errors that aren't caused by a bad request (500 series) are retried
    // automatically by the JavaScript SDK.
    const resp = await outbound_1.invokeFunction({
        FunctionName: functionArn,
        Payload: JSON.stringify(payload),
    });
    util_1.log('user function response:', resp, typeof (resp));
    const jsonPayload = parseJsonPayload(resp.Payload);
    if (resp.FunctionError) {
        util_1.log('user function threw an error:', resp.FunctionError);
        const errorMessage = jsonPayload.errorMessage || 'error';
        const trace = jsonPayload.trace ? '\nRemote function error: ' + jsonPayload.trace.join('\n') : '';
        const e = new Error(errorMessage);
        e.stack += trace;
        throw e;
    }
    return jsonPayload;
}
function parseJsonPayload(payload) {
    if (!payload) {
        return {};
    }
    const text = payload.toString();
    try {
        return JSON.parse(text);
    }
    catch (e) {
        throw new Error(`return values from user-handlers must be JSON objects. got: "${text}"`);
    }
}
function createResponseEvent(cfnRequest, onEventResult) {
    //
    // validate that onEventResult always includes a PhysicalResourceId
    onEventResult = onEventResult || {};
    // if physical ID is not returned, we have some defaults for you based
    // on the request type.
    const physicalResourceId = onEventResult.PhysicalResourceId || defaultPhysicalResourceId(cfnRequest);
    // if we are in DELETE and physical ID was changed, it's an error.
    if (cfnRequest.RequestType === 'Delete' && physicalResourceId !== cfnRequest.PhysicalResourceId) {
        throw new Error(`DELETE: cannot change the physical resource ID from "${cfnRequest.PhysicalResourceId}" to "${onEventResult.PhysicalResourceId}" during deletion`);
    }
    // if we are in UPDATE and physical ID was changed, it's a replacement (just log)
    if (cfnRequest.RequestType === 'Update' && physicalResourceId !== cfnRequest.PhysicalResourceId) {
        util_1.log(`UPDATE: changing physical resource ID from "${cfnRequest.PhysicalResourceId}" to "${onEventResult.PhysicalResourceId}"`);
    }
    // merge request event and result event (result prevails).
    return {
        ...cfnRequest,
        ...onEventResult,
        PhysicalResourceId: physicalResourceId,
    };
}
/**
 * Calculates the default physical resource ID based in case user handler did
 * not return a PhysicalResourceId.
 *
 * For "CREATE", it uses the RequestId.
 * For "UPDATE" and "DELETE" and returns the current PhysicalResourceId (the one provided in `event`).
 */
function defaultPhysicalResourceId(req) {
    switch (req.RequestType) {
        case 'Create':
            return req.RequestId;
        case 'Update':
        case 'Delete':
            return req.PhysicalResourceId;
        default:
            throw new Error(`Invalid "RequestType" in request "${JSON.stringify(req)}"`);
    }
}
module.exports = {
    [consts.FRAMEWORK_ON_EVENT_HANDLER_NAME]: cfnResponse.safeHandler(onEvent),
    [consts.FRAMEWORK_IS_COMPLETE_HANDLER_NAME]: cfnResponse.safeHandler(isComplete),
    [consts.FRAMEWORK_ON_TIMEOUT_HANDLER_NAME]: onTimeout,
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJhbWV3b3JrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZnJhbWV3b3JrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFHQSw4Q0FBOEM7QUFDOUMsbUNBQW1DO0FBQ25DLHlDQUE0RDtBQUM1RCxpQ0FBcUM7QUFTckM7Ozs7Ozs7OztHQVNHO0FBQ0gsS0FBSyxVQUFVLE9BQU8sQ0FBQyxVQUF1RDtJQUM1RSxVQUFHLENBQUMsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLENBQUM7SUFFbEMsVUFBVSxDQUFDLGtCQUFrQixHQUFHLFVBQVUsQ0FBQyxrQkFBa0IsSUFBSSxFQUFHLENBQUM7SUFFckUsTUFBTSxhQUFhLEdBQUcsTUFBTSxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsOEJBQThCLEVBQUUsVUFBVSxDQUFvQixDQUFDO0lBQ3JILFVBQUcsQ0FBQyxtQkFBbUIsRUFBRSxhQUFhLENBQUMsQ0FBQztJQUV4QyxvRkFBb0Y7SUFDcEYsaUNBQWlDO0lBQ2pDLE1BQU0sYUFBYSxHQUFHLG1CQUFtQixDQUFDLFVBQVUsRUFBRSxhQUFhLENBQUMsQ0FBQztJQUNyRSxVQUFHLENBQUMsUUFBUSxFQUFFLGFBQWEsQ0FBQyxDQUFDO0lBRTdCLGlHQUFpRztJQUNqRyxtRkFBbUY7SUFDbkYsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLGlDQUFpQyxDQUFDLEVBQUU7UUFDMUQsT0FBTyxNQUFNLFdBQVcsQ0FBQyxjQUFjLENBQUMsU0FBUyxFQUFFLGFBQWEsQ0FBQyxDQUFDO0tBQ25FO0lBRUQsMkRBQTJEO0lBQzNELE1BQU0sTUFBTSxHQUFHO1FBQ2IsZUFBZSxFQUFFLGFBQU0sQ0FBQyxNQUFNLENBQUMsNEJBQTRCLENBQUM7UUFDNUQsSUFBSSxFQUFFLGFBQWEsQ0FBQyxTQUFTO1FBQzdCLEtBQUssRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQztLQUNyQyxDQUFDO0lBRUYsVUFBRyxDQUFDLGlCQUFpQixFQUFF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QUVELDBEQUEwRDtJQUMxRCxPQUFPO1FBQ0wsR0FBRyxVQUFVO1FBQ2IsR0FBRyxhQUFhO1FBQ2hCLGtCQUFrQixFQUFFLGtCQUFrQjtLQUN2QyxDQUFDO0FBQ0osQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQVMseUJBQXlCLENBQUMsR0FBZ0Q7SUFDakYsUUFBUSxHQUFHLENBQUMsV0FBVyxFQUFFO1FBQ3ZCLEtBQUssUUFBUTtZQUNYLE9BQU8sR0FBRyxDQUFDLFNBQVMsQ0FBQztRQUV2QixLQUFLLFFBQVEsQ0FBQztRQUNkLEtBQUssUUFBUTtZQUNYLE9BQU8sR0FBRyxDQUFDLGtCQUFrQixDQUFDO1FBRWhDO1lBQ0UsTUFBTSxJQUFJLEtBQUssQ0FBQyxxQ0FBcUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7S0FDaEY7QUFDSCxDQUFDO0FBMUtELGlCQUFTO0lBQ1AsQ0FBQyxNQUFNLENBQUMsK0JBQStCLENBQUMsRUFBRSxXQUFXLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQztJQUMxRSxDQUFDLE1BQU0sQ0FBQyxrQ0FBa0MsQ0FBQyxFQUFFLFdBQVcsQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDO0lBQ2hGLENBQUMsTUFBTSxDQUFDLGlDQUFpQyxDQUFDLEVBQUUsU0FBUztDQUN0RCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gdHNsaW50OmRpc2FibGU6IG5vLWNvbnNvbGVcbi8vIHRzbGludDpkaXNhYmxlOiBtYXgtbGluZS1sZW5ndGhcbmltcG9ydCB7IElzQ29tcGxldGVSZXNwb25zZSwgT25FdmVudFJlc3BvbnNlIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0ICogYXMgY2ZuUmVzcG9uc2UgZnJvbSAnLi9jZm4tcmVzcG9uc2UnO1xuaW1wb3J0ICogYXMgY29uc3RzIGZyb20gJy4vY29uc3RzJztcbmltcG9ydCB7IGludm9rZUZ1bmN0aW9uLCBzdGFydEV4ZWN1dGlvbiB9IGZyb20gJy4vb3V0Ym91bmQnO1xuaW1wb3J0IHsgZ2V0RW52LCBsb2cgfSBmcm9tICcuL3V0aWwnO1xuXG4vLyB1c2UgY29uc3RzIGZvciBoYW5kbGVyIG5hbWVzIHRvIGNvbXBpbGVyLWVuZm9yY2UgdGhlIGNvdXBsaW5nIHdpdGggY29uc3RydWN0aW9uIGNvZGUuXG5leHBvcnQgPSB7XG4gIFtjb25zdHMuRlJBTUVXT1JLX09OX0VWRU5UX0hBTkRMRVJfTkFNRV06IGNmblJlc3BvbnNlLnNhZmVIYW5kbGVyKG9uRXZlbnQpLFxuICBbY29uc3RzLkZSQU1FV09SS19JU19DT01QTEVURV9IQU5ETEVSX05BTUVdOiBjZm5SZXNwb25zZS5zYWZlSGFuZGxlcihpc0NvbXBsZXRlKSxcbiAgW2NvbnN0cy5GUkFNRVdPUktfT05fVElNRU9VVF9IQU5ETEVSX05BTUVdOiBvblRpbWVvdXQsXG59O1xuXG4vKipcbiAqIFRoZSBtYWluIHJ1bnRpbWUgZW50cnlwb2ludCBvZiB0aGUgYXN5bmMgY3VzdG9tIHJlc291cmNlIGxhbWJkYSBmdW5jdGlvbi5cbiAqXG4gKiBBbnkgbGlmZWN5Y2xlIGV2ZW50IGNoYW5nZXMgdG8gdGhlIGN1c3RvbSByZXNvdXJjZXMgd2lsbCBpbnZva2UgdGhpcyBoYW5kbGVyLCB3aGljaCB3aWxsLCBpbiB0dXJuLFxuICogaW50ZXJhY3Qgd2l0aCB0aGUgdXNlci1kZWZpbmVkIGBvbkV2ZW50YCBhbmQgYGlzQ29tcGxldGVgIGhhbmRsZXJzLlxuICpcbiAqIFRoaXMgZnVuY3Rpb24gd2lsbCBhbHdheXMgc3VjY2VlZC4gSWYgYW4gZXJyb3Igb2NjdXJzXG4gKlxuICogQHBhcmFtIGNmblJlcXVlc3QgVGhlIGNsb3VkZm9ybWF0aW9uIGN1c3RvbSByZXNvdXJjZSBldmVudC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gb25FdmVudChjZm5SZXF1ZXN0OiBBV1NMYW1iZGEuQ2xvdWRGb3JtYXRpb25DdXN0b21SZXNvdXJjZUV2ZW50KSB7XG4gIGxvZygnb25FdmVudEhhbmRsZXInLCBjZm5SZXF1ZXN0KTtcblxuICBjZm5SZXF1ZXN0LlJlc291cmNlUHJvcGVydGllcyA9IGNmblJlcXVlc3QuUmVzb3VyY2VQcm9wZXJ0aWVzIHx8IHsgfTtcblxuICBjb25zdCBvbkV2ZW50UmVzdWx0ID0gYXdhaXQgaW52b2tlVXNlckZ1bmN0aW9uKGNvbnN0cy5VU0VSX09OX0VWRU5UX0ZVTkNUSU9OX0FSTl9FTlYsIGNmblJlcXVlc3QpIGFzIE9uRXZlbnRSZXNwb25zZTtcbiAgbG9nKCdvbkV2ZW50IHJldHVybmVkOicsIG9uRXZlbnRSZXN1bHQpO1xuXG4gIC8vIG1lcmdlIHRoZSByZXF1ZXN0IGFuZCB0aGUgcmVzdWx0IGZyb20gb25FdmVudCB0byBmb3JtIHRoZSBjb21wbGV0ZSByZXNvdXJjZSBldmVudFxuICAvLyB0aGlzIGFsc28gcGVyZm9ybXMgdmFsaWRhdGlvbi5cbiAgY29uc3QgcmVzb3VyY2VFdmVudCA9IGNyZWF0ZVJlc3BvbnNlRXZlbnQoY2ZuUmVxdWVzdCwgb25FdmVudFJlc3VsdCk7XG4gIGxvZygnZXZlbnQ6Jywgb25FdmVudFJlc3VsdCk7XG5cbiAgLy8gZGV0ZXJtaW5lIGlmIHRoaXMgaXMgYW4gYXN5bmMgcHJvdmlkZXIgYmFzZWQgb24gd2hldGhlciB3ZSBoYXZlIGFuIGlzQ29tcGxldGUgaGFuZGxlciBkZWZpbmVkLlxuICAvLyBpZiBpdCBpcyBub3QgZGVmaW5lZCwgdGhlbiB3ZSBhcmUgYmFzaWNhbGx5IHJlYWR5IHRvIHJldHVybiBhIHBvc2l0aXZlIHJlc3BvbnNlLlxuICBpZiAoIXByb2Nlc3MuZW52W2NvbnN0cy5VU0VSX0lTX0NPTVBMRVRFX0ZVTkNUSU9OX0FSTl9FTlZdKSB7XG4gICAgcmV0dXJuIGF3YWl0IGNmblJlc3BvbnNlLnN1Ym1pdFJlc3BvbnNlKCdTVUNDRVNTJywgcmVzb3VyY2VFdmVudCk7XG4gIH1cblxuICAvLyBvaywgd2UgYXJlIG5vdCBjb21wbGV0ZSwgc28ga2ljayBvZmYgdGhlIHdhaXRlciB3b3JrZmxvd1xuICBjb25zdCB3YWl0ZXIgPSB7XG4gICAgc3RhdGVNYWNoaW5lQXJuOiBnZXRFbnYoY29uc3RzLldBSVRFUl9TVEFURV9NQUNISU5FX0FSTl9FTlYpLFxuICAgIG5hbWU6IHJlc291cmNlRXZlbnQuUmVxdWVzdElkLFxuICAgIGlucHV0OiBKU09OLnN0cmluZ2lmeShyZXNvdXJjZUV2ZW50KSxcbiAgfTtcblxuICBsb2coJ3N0YXJ0aW5nIHdhaXRlcicsIHdhaXRlcik7XG5cbiAgLy8ga2ljayBvZmYgd2FpdGVyIHN0YXRlIG1hY2hpbmVcbiAgYXdhaXQgc3RhcnRFeGVjdXRpb24od2FpdGVyKTtcbn1cblxuLy8gaW52b2tlZCBhIGZldyB0aW1lcyB1bnRpbCBgY29tcGxldGVgIGlzIHRydWUgb3IgdW50aWwgaXQgdGltZXMgb3V0LlxuYXN5bmMgZnVuY3Rpb24gaXNDb21wbGV0ZShldmVudDogQVdTQ0RLQXN5bmNDdXN0b21SZXNvdXJjZS5Jc0NvbXBsZXRlUmVxdWVzdCkge1xuICBsb2coJ2lzQ29tcGxldGUnLCBldmVudCk7XG5cbiAgY29uc3QgaXNDb21wbGV0ZVJlc3VsdCA9IGF3YWl0IGludm9rZVVzZXJGdW5jdGlvbihjb25zdHMuVVNFUl9JU19DT01QTEVURV9GVU5DVElPTl9BUk5fRU5WLCBldmVudCkgYXMgSXNDb21wbGV0ZVJlc3BvbnNlO1xuICBsb2coJ3VzZXIgaXNDb21wbGV0ZSByZXR1cm5lZDonLCBpc0NvbXBsZXRlUmVzdWx0KTtcblxuICAvLyBpZiB3ZSBhcmUgbm90IGNvbXBsZXRlLCByZWV0dXJuIGZhbHNlLCBhbmQgZG9uJ3Qgc2VuZCBhIHJlc3BvbnNlIGJhY2suXG4gIGlmICghaXNDb21wbGV0ZVJlc3VsdC5Jc0NvbXBsZXRlKSB7XG4gICAgaWYgKGlzQ29tcGxldGVSZXN1bHQuRGF0YSAmJiBPYmplY3Qua2V5cyhpc0NvbXBsZXRlUmVzdWx0LkRhdGEpLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignXCJEYXRhXCIgaXMgbm90IGFsbG93ZWQgaWYgXCJJc0NvbXBsZXRlXCIgaXMgXCJGYWxzZVwiJyk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IGNmblJlc3BvbnNlLlJldHJ5KEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XG4gIH1cblxuICBjb25zdCByZXNwb25zZSA9IHtcbiAgICAuLi5ldmVudCxcbiAgICBEYXRhOiB7XG4gICAgICAuLi5ldmVudC5EYXRhLFxuICAgICAgLi4uaXNDb21wbGV0ZVJlc3VsdC5EYXRhLFxuICAgIH0sXG4gIH07XG5cbiAgYXdhaXQgY2ZuUmVzcG9uc2Uuc3VibWl0UmVzcG9uc2UoJ1NVQ0NFU1MnLCByZXNwb25zZSk7XG59XG5cbi8vIGludm9rZWQgd2hlbiBjb21wbGV0aW9uIHJldHJpZXMgYXJlIGV4aGF1c2VkLlxuYXN5bmMgZnVuY3Rpb24gb25UaW1lb3V0KHRpbWVvdXRFdmVudDogYW55KSB7XG4gIGxvZygndGltZW91dEhhbmRsZXInLCB0aW1lb3V0RXZlbnQpO1xuXG4gIGNvbnN0IGlzQ29tcGxldGVSZXF1ZXN0ID0gSlNPTi5wYXJzZShKU09OLnBhcnNlKHRpbWVvdXRFdmVudC5DYXVzZSkuZXJyb3JNZXNzYWdlKSBhcyBBV1NDREtBc3luY0N1c3RvbVJlc291cmNlLklzQ29tcGxldGVSZXF1ZXN0O1xuICBhd2FpdCBjZm5SZXNwb25zZS5zdWJtaXRSZXNwb25zZSgnRkFJTEVEJywgaXNDb21wbGV0ZVJlcXVlc3QsIHtcbiAgICByZWFzb246ICdPcGVyYXRpb24gdGltZWQgb3V0JyxcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGludm9rZVVzZXJGdW5jdGlvbihmdW5jdGlvbkFybkVudjogc3RyaW5nLCBwYXlsb2FkOiBhbnkpIHtcbiAgY29uc3QgZnVuY3Rpb25Bcm4gPSBnZXRFbnYoZnVuY3Rpb25Bcm5FbnYpO1xuICBsb2coYGV4ZWN1dGluZyB1c2VyIGZ1bmN0aW9uICR7ZnVuY3Rpb25Bcm59IHdpdGggcGF5bG9hZGAsIHBheWxvYWQpO1xuXG4gIC8vIHRyYW5zaWVudCBlcnJvcnMgc3VjaCBhcyB0aW1lb3V0cywgdGhyb3R0bGluZyBlcnJvcnMgKDQyOSksIGFuZCBvdGhlclxuICAvLyBlcnJvcnMgdGhhdCBhcmVuJ3QgY2F1c2VkIGJ5IGEgYmFkIHJlcXVlc3QgKDUwMCBzZXJpZXMpIGFyZSByZXRyaWVkXG4gIC8vIGF1dG9tYXRpY2FsbHkgYnkgdGhlIEphdmFTY3JpcHQgU0RLLlxuICBjb25zdCByZXNwID0gYXdhaXQgaW52b2tlRnVuY3Rpb24oe1xuICAgIEZ1bmN0aW9uTmFtZTogZnVuY3Rpb25Bcm4sXG4gICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXG4gIH0pO1xuXG4gIGxvZygndXNlciBmdW5jdGlvbiByZXNwb25zZTonLCByZXNwLCB0eXBlb2YocmVzcCkpO1xuXG4gIGNvbnN0IGpzb25QYXlsb2FkID0gcGFyc2VKc29uUGF5bG9hZChyZXNwLlBheWxvYWQpO1xuICBpZiAocmVzcC5GdW5jdGlvbkVycm9yKSB7XG4gICAgbG9nKCd1c2VyIGZ1bmN0aW9uIHRocmV3IGFuIGVycm9yOicsIHJlc3AuRnVuY3Rpb25FcnJvcik7XG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0ganNvblBheWxvYWQuZXJyb3JNZXNzYWdlIHx8ICdlcnJvcic7XG4gICAgY29uc3QgdHJhY2UgPSBqc29uUGF5bG9hZC50cmFjZSA/ICdcXG5SZW1vdGUgZnVuY3Rpb24gZXJyb3I6ICcgKyBqc29uUGF5bG9hZC50cmFjZS5qb2luKCdcXG4nKSA6ICcnO1xuXG4gICAgY29uc3QgZSA9IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xuICAgIGUuc3RhY2sgKz0gdHJhY2U7XG4gICAgdGhyb3cgZTtcbiAgfVxuXG4gIHJldHVybiBqc29uUGF5bG9hZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VKc29uUGF5bG9hZChwYXlsb2FkOiBhbnkpOiBhbnkge1xuICBpZiAoIXBheWxvYWQpIHsgcmV0dXJuIHsgfTsgfVxuICBjb25zdCB0ZXh0ID0gcGF5bG9hZC50b1N0cmluZygpO1xuICB0cnkge1xuICAgIHJldHVybiBKU09OLnBhcnNlKHRleHQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGByZXR1cm4gdmFsdWVzIGZyb20gdXNlci1oYW5kbGVycyBtdXN0IGJlIEpTT04gb2JqZWN0cy4gZ290OiBcIiR7dGV4dH1cImApO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVJlc3BvbnNlRXZlbnQoY2ZuUmVxdWVzdDogQVdTTGFtYmRhLkNsb3VkRm9ybWF0aW9uQ3VzdG9tUmVzb3VyY2VFdmVudCwgb25FdmVudFJlc3VsdDogT25FdmVudFJlc3BvbnNlKTogQVdTQ0RLQXN5bmNDdXN0b21SZXNvdXJjZS5Jc0NvbXBsZXRlUmVxdWVzdCB7XG4gIC8vXG4gIC8vIHZhbGlkYXRlIHRoYXQgb25FdmVudFJlc3VsdCBhbHdheXMgaW5jbHVkZXMgYSBQaHlzaWNhbFJlc291cmNlSWRcblxuICBvbkV2ZW50UmVzdWx0ID0gb25FdmVudFJlc3VsdCB8fCB7IH07XG5cbiAgLy8gaWYgcGh5c2ljYWwgSUQgaXMgbm90IHJldHVybmVkLCB3ZSBoYXZlIHNvbWUgZGVmYXVsdHMgZm9yIHlvdSBiYXNlZFxuICAvLyBvbiB0aGUgcmVxdWVzdCB0eXBlLlxuICBjb25zdCBwaHlzaWNhbFJlc291cmNlSWQgPSBvbkV2ZW50UmVzdWx0LlBoeXNpY2FsUmVzb3VyY2VJZCB8fCBkZWZhdWx0UGh5c2ljYWxSZXNvdXJjZUlkKGNmblJlcXVlc3QpO1xuXG4gIC8vIGlmIHdlIGFyZSBpbiBERUxFVEUgYW5kIHBoeXNpY2FsIElEIHdhcyBjaGFuZ2VkLCBpdCdzIGFuIGVycm9yLlxuICBpZiAoY2ZuUmVxdWVzdC5SZXF1ZXN0VHlwZSA9PT0gJ0RlbGV0ZScgJiYgcGh5c2ljYWxSZXNvdXJjZUlkICE9PSBjZm5SZXF1ZXN0LlBoeXNpY2FsUmVzb3VyY2VJZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgREVMRVRFOiBjYW5ub3QgY2hhbmdlIHRoZSBwaHlzaWNhbCByZXNvdXJjZSBJRCBmcm9tIFwiJHtjZm5SZXF1ZXN0LlBoeXNpY2FsUmVzb3VyY2VJZH1cIiB0byBcIiR7b25FdmVudFJlc3VsdC5QaHlzaWNhbFJlc291cmNlSWR9XCIgZHVyaW5nIGRlbGV0aW9uYCk7XG4gIH1cblxuICAvLyBpZiB3ZSBhcmUgaW4gVVBEQVRFIGFuZCBwaHlzaWNhbCBJRCB3YXMgY2hhbmdlZCwgaXQncyBhIHJlcGxhY2VtZW50IChqdXN0IGxvZylcbiAgaWYgKGNmblJlcXVlc3QuUmVxdWVzdFR5cGUgPT09ICdVcGRhdGUnICYmIHBoeXNpY2FsUmVzb3VyY2VJZCAhPT0gY2ZuUmVxdWVzdC5QaHlzaWNhbFJlc291cmNlSWQpIHtcbiAgICBsb2coYFVQREFURTogY2hhbmdpbmcgcGh5c2ljYWwgcmVzb3VyY2UgSUQgZnJvbSBcIiR7Y2ZuUmVxdWVzdC5QaHlzaWNhbFJlc291cmNlSWR9XCIgdG8gXCIke29uRXZlbnRSZXN1bHQuUGh5c2ljYWxSZXNvdXJjZUlkfVwiYCk7XG4gIH1cblxuICAvLyBtZXJnZSByZXF1ZXN0IGV2ZW50IGFuZCByZXN1bHQgZXZlbnQgKHJlc3VsdCBwcmV2YWlscykuXG4gIHJldHVybiB7XG4gICAgLi4uY2ZuUmVxdWVzdCxcbiAgICAuLi5vbkV2ZW50UmVzdWx0LFxuICAgIFBoeXNpY2FsUmVzb3VyY2VJZDogcGh5c2ljYWxSZXNvdXJjZUlkLFxuICB9O1xufVxuXG4vKipcbiAqIENhbGN1bGF0ZXMgdGhlIGRlZmF1bHQgcGh5c2ljYWwgcmVzb3VyY2UgSUQgYmFzZWQgaW4gY2FzZSB1c2VyIGhhbmRsZXIgZGlkXG4gKiBub3QgcmV0dXJuIGEgUGh5c2ljYWxSZXNvdXJjZUlkLlxuICpcbiAqIEZvciBcIkNSRUFURVwiLCBpdCB1c2VzIHRoZSBSZXF1ZXN0SWQuXG4gKiBGb3IgXCJVUERBVEVcIiBhbmQgXCJERUxFVEVcIiBhbmQgcmV0dXJucyB0aGUgY3VycmVudCBQaHlzaWNhbFJlc291cmNlSWQgKHRoZSBvbmUgcHJvdmlkZWQgaW4gYGV2ZW50YCkuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRQaHlzaWNhbFJlc291cmNlSWQocmVxOiBBV1NMYW1iZGEuQ2xvdWRGb3JtYXRpb25DdXN0b21SZXNvdXJjZUV2ZW50KTogc3RyaW5nIHtcbiAgc3dpdGNoIChyZXEuUmVxdWVzdFR5cGUpIHtcbiAgICBjYXNlICdDcmVhdGUnOlxuICAgICAgcmV0dXJuIHJlcS5SZXF1ZXN0SWQ7XG5cbiAgICBjYXNlICdVcGRhdGUnOlxuICAgIGNhc2UgJ0RlbGV0ZSc6XG4gICAgICByZXR1cm4gcmVxLlBoeXNpY2FsUmVzb3VyY2VJZDtcblxuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgXCJSZXF1ZXN0VHlwZVwiIGluIHJlcXVlc3QgXCIke0pTT04uc3RyaW5naWZ5KHJlcSl9XCJgKTtcbiAgfVxufVxuIl19