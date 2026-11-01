declare const Deno:{env:{get:(key:string)=>string|undefined};serve:(handler:(request:Request)=>Response|Promise<Response>)=>void};
declare const EdgeRuntime:{waitUntil:(promise:Promise<unknown>)=>void};
