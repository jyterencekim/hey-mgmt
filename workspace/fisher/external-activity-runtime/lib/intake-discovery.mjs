import { IntakeRun } from './intake-run.mjs';
import { unpack } from './intake-coverage.mjs';

// The scheduled entrypoint invokes real app callbacks. No caller-supplied pass
// flags or synthetic counts. Dates always derive from one frozen UTC window.
export async function discoverIntake(tools, { after, before, priorDispositions = {} }) {
  const profile = unpack(await tools.mcp__codex_apps__gmail_get_profile({}));
  if (profile.email !== 'jared.lee@kaia.io') throw new Error('Wrong Gmail identity');
  const db = unpack(await tools.mcp__codex_apps__notion_fetch({ id: '1e58f758b60f4ce9bf0111c3119e959b' }));
  const ds = 'collection://0623cda6-b2c5-4dbb-8587-c0e7feaac076';
  if (!db.text?.includes(ds) || !db.text.includes('3d60b640-81c0-4985-9b9e-b43155b7dc14')) throw new Error('Notion authority mismatch');
  const slack = unpack(await tools.mcp__codex_apps__slack_slack_read_user_profile({}));
  if (!JSON.stringify(slack).includes('U07EPER3998')) throw new Error('Wrong Slack identity');
  const start = new Date(after).toISOString(), end = new Date(before).toISOString();
  const kinds = ['public_channel','private_channel','im','mpim','mentions','participated'];
  const required = ['gmail-inbox','gmail-sent','drive','notion', ...kinds];
  const run = new IntakeRun({ after: start, before: end, required, priorDispositions });
  const sources = {};
  const jobs = [
    ...['inbox','sent'].map(folder => [`gmail-${folder}`, a => tools.mcp__codex_apps__gmail_search_emails(a), { query: `in:${folder} after:${Date.parse(start)/1000} before:${Date.parse(end)/1000}`, max_results:100 }, {kind:'rows',cursorKey:'next_page_token'}]),
    ['drive', a => tools.mcp__codex_apps__google_drive_search(a), {item_type:'document',special_filter_query_str:`trashed=false and modifiedTime >= '${start}' and modifiedTime <= '${end}'`,topn:100},{kind:'rows',cursorKey:'page_token'}],
    ['notion', async a => {
      const result=await tools.mcp__codex_apps__notion_query_data_sources(a);
      if ((unpack(result).results?.length ?? 0) >= 100) throw new Error('Notion SQL keyset continuation required; do not advance watermark');
      return result;
    },{data:{data_source_urls:[ds],query:`SELECT * FROM "${ds}" WHERE datetime("Created") >= datetime('${start}') AND datetime("Created") <= datetime('${end}') ORDER BY datetime("Created") DESC, url ASC LIMIT 100`}},{kind:'rows'}],
    ...kinds.map(kind => [kind,a => tools.mcp__codex_apps__slack_slack_search_public_and_private(a),{
      query:kind==='mentions'?'<@U07EPER3998>':kind==='participated'?'from:<@U07EPER3998> is:thread':`after:${new Date(Date.parse(start)-86400000).toISOString().slice(0,10)}`,
      after:String(Date.parse(start)/1000),before:String(Date.parse(end)/1000),channel_types:['mentions','participated'].includes(kind)?'public_channel,private_channel,im,mpim':kind,
      sort:'timestamp',sort_dir:'asc',limit:20,include_context:false,include_bots:false,
    },{}]),
  ];
  const outcomes=await Promise.allSettled(jobs.map(async ([name,call,args,options]) => {sources[name]=await run.collect(name,call,args,options);}));
  return {run,sources,failures:outcomes.flatMap((r,i)=>r.status==='rejected'?[{lane:jobs[i][0],error:String(r.reason)}]:[])};
}
