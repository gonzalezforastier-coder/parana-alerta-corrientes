const barrios=["Galván","Bajo Galván","Santa Marta","Quilmes","Virgen de los Dolores","Caridi","Cichero","Bañado Norte","Sol de Mayo","Itatí","Quinta Ferré","Anahí","Lomas del Mirador","Molina Punta","Punta Taitalo"];
document.querySelector('#chips').innerHTML=barrios.map(x=>`<span class="chip">${x}</span>`).join('');

const simRange=document.querySelector('#sim-range');
const simValue=document.querySelector('#sim-value');
const gaugeFill=document.querySelector('#gauge-fill');
const simTag=document.querySelector('#sim-tag');
const simTitle=document.querySelector('#sim-title');
const simText=document.querySelector('#sim-text');
function updateSimulation(){
  const value=Number(simRange.value);
  simValue.textContent=value.toFixed(2).replace('.',',');
  gaugeFill.style.height=`${Math.max(0,Math.min(100,(value-4)/5.5*100))}%`;
  let state;
  if(value>=7) state=['EVACUACIÓN','Supera el nivel de evacuación','Las zonas ribereñas requieren seguimiento directo de Defensa Civil y confirmación de los centros habilitados.','#f7d5d0','#a7291c'];
  else if(value>=6.5) state=['ALERTA','Supera el nivel de alerta','Es momento de preparar documentación, medicación y una vía de salida, siguiendo únicamente indicaciones oficiales.','#f8e6bd','#805500'];
  else state=['SEGUIMIENTO','Por debajo de alerta','El río permanece por debajo de los umbrales oficiales, aunque las lluvias urbanas pueden causar anegamientos por separado.','#d7ece9','#086c69'];
  [simTag.textContent,simTitle.textContent,simText.textContent]=state;
  simTag.style.background=state[3];simTag.style.color=state[4];
}
simRange.addEventListener('input',updateSimulation);updateSimulation();

const refresh=document.querySelector('#refresh');
const note=document.querySelector('#refresh-note');
refresh.addEventListener('click',async()=>{
  refresh.disabled=true; refresh.textContent='Consultando al INA…';
  try{
    const response=await fetch('https://alerta.ina.gob.ar/a5/diario/reporte_diario',{cache:'no-store'});
    if(!response.ok) throw new Error('sin respuesta');
    const html=await response.text();
    const plain=new DOMParser().parseFromString(html,'text/html').body.innerText.replace(/\s+/g,' ');
    const match=plain.match(/Corrientes\s+Paran[aá]\s+([0-9]+[,.][0-9]+)/i);
    if(!match) throw new Error('dato no localizado');
    const value=match[1].replace('.',',');
    document.querySelector('#height').textContent=value;
    document.querySelector('#measurement-time').textContent=`INA · comprobado ${new Date().toLocaleString('es-AR',{dateStyle:'long',timeStyle:'short'})}`;
    note.textContent='Fuente oficial consultada correctamente. El valor mostrado proviene del reporte del INA.';
  }catch(e){
    note.textContent='El INA no permitió la consulta automática desde el navegador. Conservamos el último dato verificado y su fecha; podés abrir la fuente directa abajo.';
  }finally{refresh.disabled=false;refresh.textContent='Comprobar fuente oficial'}
});
