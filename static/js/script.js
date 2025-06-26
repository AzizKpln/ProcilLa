let rawData = [];
let filteredData = [];
let simulation;
let svg, g;
let nodes = [], links = [];
let selectedNode = null;
let isNodeSelected = false;
let apiKey = '';

document.addEventListener('DOMContentLoaded', function() {
    initializeVisualization();
    bindEventListeners();
    loadNotes();
});

function initializeVisualization() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    svg = d3.select("#networkSvg").attr("width", width).attr("height", height);
    
    const zoom = d3.zoom().scaleExtent([0.1, 10])
        .on("zoom", (event) => { g.attr("transform", event.transform); });
    
    svg.call(zoom);
    g = svg.append("g");
    
    const defs = svg.append("defs");
    
    const processGradient = defs.append("radialGradient").attr("id", "processGradient");
    processGradient.append("stop").attr("offset", "0%").attr("stop-color", "#ffffcc");
    processGradient.append("stop").attr("offset", "100%").attr("stop-color", "#ffff00");
    
    const successGradient = defs.append("radialGradient").attr("id", "successGradient");
    successGradient.append("stop").attr("offset", "0%").attr("stop-color", "#98fb98");
    successGradient.append("stop").attr("offset", "100%").attr("stop-color", "#90ee90");
    
    svg.on("click", () => {
        if (selectedNode) closeEntryPanel();
    });
}

function bindEventListeners() {
    window.togglePanel = function(panelType) {
        const content = document.getElementById(panelType + 'Content');
        const toggle = document.getElementById(panelType + 'Toggle');
        
        if (content.classList.contains('collapsed')) {
            content.classList.remove('collapsed');
            toggle.textContent = '−';
        } else {
            content.classList.add('collapsed');
            toggle.textContent = '+';
        }
    };

    document.getElementById('csvFile').addEventListener('change', handleFileUpload);
    document.getElementById('processFilter').addEventListener('input', applyFilters);
    document.getElementById('operationFilter').addEventListener('change', applyFilters);
    document.getElementById('resultFilter').addEventListener('change', applyFilters);
    document.getElementById('maxNodes').addEventListener('input', function() {
        document.getElementById('maxNodesValue').textContent = this.value;
        applyFilters();
    });

    document.getElementById('addNoteBtn').addEventListener('click', addNote);
    document.getElementById('noteInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            addNote();
        }
    });

    document.getElementById('apiKeyInput').addEventListener('input', (e) => {
        apiKey = e.target.value;
        updateAIButtons();
    });

    document.getElementById('analyzeAllBtn').addEventListener('click', () => analyzeWithAI('all'));
    document.getElementById('analyzeSelectedBtn').addEventListener('click', () => analyzeWithAI('selected'));
    document.getElementById('securityAssessBtn').addEventListener('click', () => analyzeWithAI('security'));
    document.getElementById('persistenceCheckBtn').addEventListener('click', () => analyzeWithAI('persistence'));

    document.getElementById('zoomIn').addEventListener('click', () => {
        svg.transition().duration(300).call(d3.zoom().scaleBy, 1.5);
    });
    document.getElementById('zoomOut').addEventListener('click', () => {
        svg.transition().duration(300).call(d3.zoom().scaleBy, 1/1.5);
    });
    document.getElementById('resetZoom').addEventListener('click', () => {
        svg.transition().duration(500).call(d3.zoom().transform, d3.zoomIdentity);
    });

    document.getElementById('closeEntryPanel').addEventListener('click', closeEntryPanel);
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    const statusDiv = document.getElementById('uploadStatus');
    statusDiv.textContent = `Uploading ${file.name}...`;
    statusDiv.className = 'status-message';

    try {
        console.log('Uploading file:', file.name);
        
        const response = await fetch('/upload_csv', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        console.log('Upload response:', result);

        if (result.success) {
            rawData = result.data;
            console.log('Loaded data:', rawData.length, 'records');
            console.log('Columns:', result.columns);
            console.log('Sample data:', result.sample_data);
            
            populateFilterOptions();
            applyFilters();
            
            statusDiv.textContent = `✓ Loaded ${result.total_rows} rows successfully`;
            statusDiv.className = 'status-message status-success';
            
            // Show debug info
            if (result.sample_data && result.sample_data.length > 0) {
                console.log('Available columns in data:', Object.keys(result.sample_data[0]));
            }
        } else {
            console.error('Upload failed:', result.error);
            statusDiv.textContent = `❌ ${result.error}`;
            statusDiv.className = 'status-message status-error';
        }
    } catch (error) {
        console.error('Upload error:', error);
        statusDiv.textContent = `❌ Upload failed: ${error.message}`;
        statusDiv.className = 'status-message status-error';
    }
}

function populateFilterOptions() {
    console.log('Populating filter options...');
    
    // Get operations from data
    const operations = [...new Set(rawData.map(row => row.Operation || row.operation || ''))].filter(op => op).sort();
    console.log('Found operations:', operations);
    
    const operationSelect = document.getElementById('operationFilter');
    operationSelect.innerHTML = '<option value="">All Operations</option>';
    operations.forEach(op => {
        const option = document.createElement('option');
        option.value = op;
        option.textContent = op;
        operationSelect.appendChild(option);
    });
}

function applyFilters() {
    console.log('Applying filters...');
    
    const processFilter = document.getElementById('processFilter').value.toLowerCase();
    const operationFilter = document.getElementById('operationFilter').value;
    const resultFilter = document.getElementById('resultFilter').value;
    const maxNodes = parseInt(document.getElementById('maxNodes').value);

    filteredData = rawData.filter(row => {
        // Handle different possible column names
        const processName = row['Process Name'] || row['ProcessName'] || row.process || row.Process || '';
        const operation = row.Operation || row.operation || '';
        const result = row.Result || row.result || '';
        
        const matchProcess = !processFilter || processName.toLowerCase().includes(processFilter);
        const matchOperation = !operationFilter || operation === operationFilter;
        const matchResult = !resultFilter || result === resultFilter;
        
        return matchProcess && matchOperation && matchResult;
    }).slice(0, maxNodes);

    console.log('Filtered data:', filteredData.length, 'records');
    
    updateStats();
    createNetworkGraph();
}

function updateStats() {
    const totalOps = filteredData.length;
    const processes = new Set(filteredData.map(row => 
        row['Process Name'] || row['ProcessName'] || row.process || row.Process || ''
    )).size;
    const successful = filteredData.filter(row => 
        (row.Result || row.result || '') === 'SUCCESS'
    ).length;
    const failed = totalOps - successful;
    const successRate = totalOps > 0 ? Math.round((successful / totalOps) * 100) : 0;
    const files = new Set(filteredData.map(row => 
        row.Path || row.path || ''
    )).size;
    const systemFiles = filteredData.filter(row => {
        const path = row.Path || row.path || '';
        return path.includes('System32') || path.includes('Windows');
    }).length;

    document.getElementById('totalOps').textContent = totalOps;
    document.getElementById('processCount').textContent = processes;
    document.getElementById('successRate').textContent = successRate + '%';
    document.getElementById('fileCount').textContent = files;
    document.getElementById('failedOps').textContent = failed;
    document.getElementById('systemFiles').textContent = systemFiles;
}

function createNetworkGraph() {
    console.log('Creating network graph...');
    
    g.selectAll("*").remove();
    if (filteredData.length === 0) {
        console.log('No data to visualize');
        return;
    }

    nodes = [];
    links = [];
    const nodeMap = new Map();

    const processes = [...new Set(filteredData.map(row => 
        row['Process Name'] || row['ProcessName'] || row.process || row.Process || 'unknown'
    ))];
    
    console.log('Found processes:', processes);
    
    processes.forEach(process => {
        const id = `process_${process}`;
        if (!nodeMap.has(id)) {
            const relatedOps = filteredData.filter(row => 
                (row['Process Name'] || row['ProcessName'] || row.process || row.Process || '') === process
            );
            const node = {
                id: id,
                label: process,
                type: 'process',
                group: 'process',
                operations: relatedOps,
                successCount: relatedOps.filter(op => (op.Result || op.result || '') === 'SUCCESS').length,
                errorCount: relatedOps.filter(op => (op.Result || op.result || '') !== 'SUCCESS').length
            };
            nodes.push(node);
            nodeMap.set(id, node);
        }
    });

    const fileMap = new Map();
    filteredData.forEach(row => {
        const processName = row['Process Name'] || row['ProcessName'] || row.process || row.Process || 'unknown';
        const processId = `process_${processName}`;
        const path = row.Path || row.path || '';
        const fileName = (path && path.split('\\').pop()) || path || 'unknown';
        const fileKey = `${fileName}_${path}`;
        
        if (!fileMap.has(fileKey)) {
            const isSystemFile = path && (path.includes('System32') || path.includes('Windows') || path.includes('Program Files'));
            const fileId = `file_${fileKey}`;
            const result = row.Result || row.result || '';
            
            const node = {
                id: fileId,
                label: fileName,
                type: result === 'SUCCESS' ? 'file-success' : 'file-error',
                group: isSystemFile ? 'system' : 'file',
                path: path,
                result: result,
                operation: row.Operation || row.operation || ''
            };
            nodes.push(node);
            nodeMap.set(fileId, node);
            fileMap.set(fileKey, fileId);
        }

        links.push({
            source: processId,
            target: fileMap.get(fileKey),
            operation: row.Operation || row.operation || '',
            result: row.Result || row.result || ''
        });
    });

    console.log('Created nodes:', nodes.length, 'links:', links.length);

    simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(150))
        .force("charge", d3.forceManyBody().strength(-300))
        .force("center", d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2))
        .force("collision", d3.forceCollide().radius(30));

    const link = g.append("g")
        .selectAll("line")
        .data(links)
        .enter().append("line")
        .attr("class", d => `link link-${d.result.toLowerCase().replace(/\s+/g, '-')}`)
        .style("stroke", d => d.result === 'SUCCESS' ? '#008000' : '#ff0000')
        .style("stroke-opacity", 0.7)
        .style("stroke-width", 2);

    const node = g.append("g")
        .selectAll("g")
        .data(nodes)
        .enter().append("g")
        .attr("class", "node")
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    node.append("circle")
        .attr("r", d => d.type === 'process' ? 20 : (d.group === 'system' ? 15 : 12))
        .attr("class", d => `node-${d.type}`)
        .style("fill", d => {
            if (d.type === 'process') return "url(#processGradient)";
            if (d.type === 'file-success') return d.group === 'system' ? '#87ceeb' : "url(#successGradient)";
            if (d.type === 'file-error') return '#ff4500';
            return '#d3d3d3';
        })
        .style("stroke", d => {
            if (d.type === 'process') return '#000000';
            if (d.type === 'file-success') return d.group === 'system' ? '#0000ff' : '#008000';
            if (d.type === 'file-error') return '#ff0000';
            return '#808080';
        })
        .style("stroke-width", 2);

    node.append("text")
        .attr("class", "node-text")
        .attr("dy", d => d.type === 'process' ? 35 : (d.group === 'system' ? 25 : 22))
        .style("font-size", d => d.type === 'process' ? '12px' : '10px')
        .text(d => {
            const maxLength = d.type === 'process' ? 12 : 15;
            return d.label.length > maxLength ? d.label.substring(0, maxLength) + '...' : d.label;
        });

    node.on("click", function(event, d) {
        event.stopPropagation();
        selectNode(d);
    })
    .on("mouseenter", function(event, d) {
        if (!isNodeSelected) showTooltip(event, d);
    })
    .on("mouseleave", function() {
        if (!isNodeSelected) hideTooltip();
    });

    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node.attr("transform", d => `translate(${d.x},${d.y})`);
    });
}

function selectNode(nodeData) {
    console.log('Selected node:', nodeData);
    
    hideTooltip();
    d3.selectAll('.node').classed('node-selected', false);
    
    selectedNode = nodeData;
    isNodeSelected = true;
    
    d3.selectAll('.node').filter(d => d.id === nodeData.id).classed('node-selected', true);
    
    showDetailPanel(nodeData);
    document.getElementById('analyzeSelectedBtn').disabled = !apiKey;
}

function showDetailPanel(nodeData) {
    const entryContent = document.getElementById('entryContent');
    
    let html = '';
    if (nodeData.type === 'process') {
        const totalOps = nodeData.successCount + nodeData.errorCount;
        const successRate = totalOps > 0 ? Math.round((nodeData.successCount / totalOps) * 100) : 0;
        
        // Enhanced process analysis
        const registryOps = nodeData.operations.filter(op => {
            const path = op.Path || op.path || '';
            return path.toLowerCase().includes('registry') || path.toLowerCase().includes('hkey');
        }).length;
        
        const networkOps = nodeData.operations.filter(op => {
            const path = op.Path || op.path || '';
            return path.includes('ws2_32') || path.includes('winhttp') || path.includes('wininet');
        }).length;
        
        const systemOps = nodeData.operations.filter(op => {
            const path = op.Path || op.path || '';
            return path.includes('System32') || path.includes('Windows');
        }).length;
        
        html = `
            <div class="entry-item">
                <div class="entry-label">Process Analysis</div>
                <div class="entry-value">
                    <strong>${nodeData.label}</strong><br/>
                    Total Operations: ${totalOps}<br/>
                    Success Rate: ${successRate}%
                </div>
            </div>
            <div class="entry-item">
                <div class="entry-label">Operation Breakdown</div>
                <div class="entry-value">
                    ✅ Success: ${nodeData.successCount}<br/>
                    ❌ Failed: ${nodeData.errorCount}<br/>
                    📝 Registry: ${registryOps}<br/>
                    🌐 Network: ${networkOps}<br/>
                    🛡️ System: ${systemOps}
                </div>
            </div>
            <div class="entry-item">
                <div class="entry-label">Security Assessment</div>
                <div class="entry-value">
                    ${generateProcessSecurityAssessment(nodeData)}
                </div>
            </div>
        `;
    } else {
        html = `
            <div class="entry-item">
                <div class="entry-label">File Analysis</div>
                <div class="entry-value">
                    <strong>${nodeData.label}</strong><br/>
                    Result: ${nodeData.result}<br/>
                    Type: ${nodeData.group === 'system' ? 'System File' : 'User File'}
                </div>
            </div>
            <div class="entry-item">
                <div class="entry-label">File Path</div>
                <div class="entry-value" style="word-break: break-all;">
                    ${nodeData.path || 'Unknown'}
                </div>
            </div>
            <div class="entry-item">
                <div class="entry-label">Security Impact</div>
                <div class="entry-value">
                    ${generateFileSecurityAssessment(nodeData)}
                </div>
            </div>
        `;
    }
    
    entryContent.innerHTML = html;
    document.getElementById('entryPanel').classList.add('open');
}

function generateProcessSecurityAssessment(nodeData) {
    const totalOps = nodeData.successCount + nodeData.errorCount;
    const errorRate = nodeData.errorCount / totalOps;
    
    let assessment = [];
    
    if (errorRate > 0.5) {
        assessment.push('🚨 HIGH ERROR RATE - Possible reconnaissance activity');
    } else if (errorRate > 0.2) {
        assessment.push('⚠️ MODERATE ERROR RATE - Some access restrictions');
    } else {
        assessment.push('✅ LOW ERROR RATE - Normal access patterns');
    }
    
    const registryOps = nodeData.operations.filter(op => {
        const path = op.Path || op.path || '';
        return path.toLowerCase().includes('registry') || path.toLowerCase().includes('hkey');
    }).length;
    
    if (registryOps > 0) {
        assessment.push(`📝 Registry access detected (${registryOps} ops)`);
    }
    
    return assessment.join('<br/>');
}

function generateFileSecurityAssessment(nodeData) {
    let assessment = [];
    
    if (nodeData.result !== 'SUCCESS') {
        assessment.push('❌ ACCESS DENIED - Potential security restriction');
    } else {
        assessment.push('✅ ACCESS GRANTED - Successful file operation');
    }
    
    if (nodeData.group === 'system') {
        assessment.push('🛡️ SYSTEM FILE - Critical system resource');
    } else {
        assessment.push('📁 USER FILE - Application data');
    }
    
    return assessment.join('<br/>');
}

function closeEntryPanel() {
    document.getElementById('entryPanel').classList.remove('open');
    d3.selectAll('.node').classed('node-selected', false);
    selectedNode = null;
    isNodeSelected = false;
    document.getElementById('analyzeSelectedBtn').disabled = true;
}

function showTooltip(event, nodeData) {
    const tooltip = document.getElementById('tooltip');
    let content = `<strong style="color: #000000; background: #ffff00; padding: 2px 4px;">${nodeData.label}</strong><br/>`;
    content += `<span style="color: #000000;">Type:</span> <span style="color: #0000ff; font-weight: bold;">${nodeData.type}</span><br/>`;
    
    if (nodeData.type === 'process') {
        const totalOps = nodeData.successCount + nodeData.errorCount;
        const successRate = totalOps > 0 ? Math.round((nodeData.successCount / totalOps) * 100) : 0;
        content += `<span style="color: #000000;">Operations:</span> <span style="color: #0000ff; font-weight: bold;">${totalOps}</span><br/>`;
        content += `<span style="color: #000000;">Success Rate:</span> <span style="color: #008000; font-weight: bold;">${successRate}%</span>`;
    } else {
        content += `<span style="color: #000000;">Result:</span> <span style="color: ${nodeData.result === 'SUCCESS' ? '#008000' : '#ff0000'}; font-weight: bold;">${nodeData.result}</span><br/>`;
        content += `<span style="color: #000000;">File:</span> <span style="color: #000000; background: #ffffcc; padding: 1px 2px;">${nodeData.label}</span>`;
    }
    
    tooltip.innerHTML = content;
    tooltip.style.display = 'block';
    tooltip.style.left = (event.pageX + 15) + 'px';
    tooltip.style.top = (event.pageY - 15) + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
}

function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = event.x;
    d.fy = event.y;
}

async function addNote() {
    const noteInput = document.getElementById('noteInput');
    const noteText = noteInput.value.trim();
    
    if (noteText) {
        try {
            const response = await fetch('/save_note', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    note: noteText,
                    selected_node: selectedNode ? selectedNode.label : null
                })
            });
            
            const result = await response.json();
            if (result.success) {
                noteInput.value = '';
                loadNotes();
            }
        } catch (error) {
            console.error('Error saving note:', error);
        }
    }
}

async function loadNotes() {
    try {
        const response = await fetch('/get_notes');
        const result = await response.json();
        
        const notesList = document.getElementById('notesList');
        notesList.innerHTML = '';
        
        result.notes.slice().reverse().forEach(note => {
            const noteDiv = document.createElement('div');
            noteDiv.className = 'note-item';
            noteDiv.innerHTML = `
                <div class="note-timestamp">${note.timestamp}${note.selected_node ? ' - ' + note.selected_node : ''}</div>
                <div class="note-text">${note.text}</div>
                <button class="note-delete" onclick="deleteNote(${note.id})">×</button>
            `;
            notesList.appendChild(noteDiv);
        });
    } catch (error) {
        console.error('Error loading notes:', error);
    }
}

async function deleteNote(noteId) {
    try {
        await fetch('/delete_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note_id: noteId })
        });
        loadNotes();
    } catch (error) {
        console.error('Error deleting note:', error);
    }
}

function updateAIButtons() {
    const hasApiKey = apiKey.length > 0;
    document.getElementById('analyzeAllBtn').disabled = !hasApiKey || filteredData.length === 0;
    document.getElementById('securityAssessBtn').disabled = !hasApiKey || filteredData.length === 0;
    document.getElementById('persistenceCheckBtn').disabled = !hasApiKey || filteredData.length === 0;
    
    if (hasApiKey && selectedNode) {
        document.getElementById('analyzeSelectedBtn').disabled = false;
    } else {
        document.getElementById('analyzeSelectedBtn').disabled = true;
    }
}

async function analyzeWithAI(analysisType) {
    if (!apiKey) {
        alert('Please enter your OpenAI API key first.');
        return;
    }

    if (filteredData.length === 0) {
        alert('Please upload and process CSV data first.');
        return;
    }

    const resultDiv = document.getElementById('aiResult');
    resultDiv.style.display = 'block';
    resultDiv.textContent = 'Analyzing with AI...';

    try {
        let selectedData = null;
        if (analysisType === 'selected' && selectedNode) {
            selectedData = selectedNode.operations || selectedNode;
        }

        const response = await fetch('/analyze_ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: apiKey,
                analysis_type: analysisType,
                selected_data: selectedData
            })
        });

        const result = await response.json();
        
        if (result.success) {
            resultDiv.textContent = result.analysis;
        } else {
            resultDiv.textContent = '❌ Error: ' + result.error;
        }

    } catch (error) {
        resultDiv.textContent = '❌ Network Error: ' + error.message;
        console.error('AI analysis error:', error);
    }
}

window.debugCSV = async function() {
    try {
        const response = await fetch('/debug_csv');
        const result = await response.json();
        console.log('CSV Debug Info:', result);
        alert(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Debug error:', error);
    }
};