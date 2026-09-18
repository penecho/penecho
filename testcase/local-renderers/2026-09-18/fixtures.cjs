// Browser acceptance fixtures; uses the production renderer without replacing it.
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('../../../public/plugins/flowchart/runtime.js');
const fixtures = [
  {id:'dot',title:'本地渲染验收 · DOT 结构图',source:`digraph G {
    graph [rankdir=LR, pad=0.3, nodesep=0.5, ranksep=0.7];
    node [shape=box, style="rounded,filled", fillcolor="#eff6ff", color="#3b82f6", fontname="Arial", fontsize=18, margin="0.22,0.14"];
    edge [color="#64748b", fontname="Arial", fontsize=14];
    User [label="Client"];
    subgraph cluster_service {label="Service boundary"; color="#14b8a6"; API [label="API Gateway"]; Worker [label="Worker"]; API -> Worker [label="dispatch"];}
    Store [label="Database",shape=cylinder,fillcolor="#f3e8ff",color="#a855f7"];
    Cache [label="Cache",fillcolor="#ecfdf5",color="#10b981"];
    User -> API [label="request"]; Worker -> Store [label="write"]; API -> Cache [label="read"];
  }`},
  {id:'bpmn-xml',title:'本地渲染验收 · BPMN 业务流程',source:`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions" targetNamespace="urn:penecho:test">
<bpmn:process id="Process" isExecutable="false"><bpmn:startEvent id="Start" name="Receive"/><bpmn:task id="Review" name="Review request"/><bpmn:exclusiveGateway id="Decision" name="Approved?"/><bpmn:task id="Fulfil" name="Fulfil order"/><bpmn:task id="Reject" name="Notify rejection"/><bpmn:endEvent id="End" name="Done"/>
<bpmn:sequenceFlow id="f1" sourceRef="Start" targetRef="Review"/><bpmn:sequenceFlow id="f2" sourceRef="Review" targetRef="Decision"/><bpmn:sequenceFlow id="f3" name="Yes" sourceRef="Decision" targetRef="Fulfil"/><bpmn:sequenceFlow id="f4" name="No" sourceRef="Decision" targetRef="Reject"/><bpmn:sequenceFlow id="f5" sourceRef="Fulfil" targetRef="End"/><bpmn:sequenceFlow id="f6" sourceRef="Reject" targetRef="End"/></bpmn:process>
<bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process">
<bpmndi:BPMNShape id="s1" bpmnElement="Start"><dc:Bounds x="60" y="142" width="36" height="36"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="s2" bpmnElement="Review"><dc:Bounds x="150" y="120" width="130" height="80"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="s3" bpmnElement="Decision" isMarkerVisible="true"><dc:Bounds x="340" y="135" width="50" height="50"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="s4" bpmnElement="Fulfil"><dc:Bounds x="460" y="50" width="140" height="80"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="s5" bpmnElement="Reject"><dc:Bounds x="460" y="220" width="140" height="80"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="s6" bpmnElement="End"><dc:Bounds x="690" y="142" width="36" height="36"/></bpmndi:BPMNShape>
<bpmndi:BPMNEdge id="e1" bpmnElement="f1"><di:waypoint x="96" y="160"/><di:waypoint x="150" y="160"/></bpmndi:BPMNEdge>
<bpmndi:BPMNEdge id="e2" bpmnElement="f2"><di:waypoint x="280" y="160"/><di:waypoint x="340" y="160"/></bpmndi:BPMNEdge>
<bpmndi:BPMNEdge id="e3" bpmnElement="f3"><di:waypoint x="365" y="135"/><di:waypoint x="365" y="90"/><di:waypoint x="460" y="90"/></bpmndi:BPMNEdge>
<bpmndi:BPMNEdge id="e4" bpmnElement="f4"><di:waypoint x="365" y="185"/><di:waypoint x="365" y="260"/><di:waypoint x="460" y="260"/></bpmndi:BPMNEdge>
<bpmndi:BPMNEdge id="e5" bpmnElement="f5"><di:waypoint x="600" y="90"/><di:waypoint x="708" y="90"/><di:waypoint x="708" y="142"/></bpmndi:BPMNEdge>
<bpmndi:BPMNEdge id="e6" bpmnElement="f6"><di:waypoint x="600" y="260"/><di:waypoint x="708" y="260"/><di:waypoint x="708" y="178"/></bpmndi:BPMNEdge>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`},
  {id:'vega-lite',title:'本地渲染验收 · Vega-Lite 数据图',source:JSON.stringify({$schema:'https://vega.github.io/schema/vega-lite/v5.json',description:'Synthetic test data; not product measurements.',width:'container',height:'container',background:'#ffffff',autosize:{type:'fit',contains:'padding'},data:{values:[{module:'Canvas',value:32},{module:'MCP',value:24},{module:'Agent',value:18},{module:'Storage',value:12}]},mark:{type:'bar',cornerRadiusEnd:5},encoding:{x:{field:'module',type:'nominal',title:'Module'},y:{field:'value',type:'quantitative',title:'Synthetic sample count'},color:{field:'module',type:'nominal',legend:null},tooltip:[{field:'module'},{field:'value'}]},config:{axis:{labelFontSize:16,titleFontSize:17,labelAngle:0}}})},
  {id:'geojson',title:'本地渲染验收 · GeoJSON 地理数据',source:JSON.stringify({type:'FeatureCollection',basemap:'none',features:[{type:'Feature',properties:{name:'Test area'},geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,1],[0,1],[0,0]]]}},{type:'Feature',properties:{name:'Route'},geometry:{type:'LineString',coordinates:[[.2,.2],[.8,.8],[1.8,.3]]}},...[ [.2,.2],[.8,.8],[1.8,.3]].map((coordinates,i)=>({type:'Feature',properties:{name:`Site ${i+1}`},geometry:{type:'Point',coordinates}}))]})},
  {id:'smiles',title:'本地渲染验收 · SMILES 分子结构',source:'CC(=O)Oc1ccccc1C(=O)O'},
  {id:'cytoscape-json',title:'本地渲染验收 · Cytoscape 关系网络',source:JSON.stringify({elements:[...['Client','Gateway','Worker','Store','Cache','Events'].map(id=>({data:{id,label:id}})),...[['Client','Gateway','request'],['Gateway','Worker','dispatch'],['Gateway','Cache','read'],['Worker','Store','write'],['Worker','Events','publish'],['Events','Cache','invalidate']].map(([source,target,label],i)=>({data:{id:`e${i}`,source,target,label}}))]})},
];
for(const f of fixtures){fs.writeFileSync(path.join(__dirname,f.id+'.source'),f.source);fs.writeFileSync(path.join(__dirname,f.id+'.html'),runtime.documentFor({sourceFormat:f.id,source:f.source,title:f.title}));}
module.exports=fixtures;
