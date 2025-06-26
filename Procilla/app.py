from flask import Flask, render_template, request, jsonify, session
import pandas as pd
import json
import os
from datetime import datetime
import openai
from werkzeug.utils import secure_filename
import logging

app = Flask(__name__)
app.secret_key = '1234'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max
logging.basicConfig(level=logging.DEBUG)
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs('templates', exist_ok=True)
os.makedirs('static/css', exist_ok=True)
os.makedirs('static/js', exist_ok=True)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload_csv', methods=['POST'])
def upload_csv():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Case-insensitive CSV check
        if file and file.filename.lower().endswith('.csv'):
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            
            app.logger.info(f"File saved to: {filepath}")
            
            try:
                # Try different CSV reading methods
                try:
                    # First try with default settings
                    df = pd.read_csv(filepath)
                    app.logger.info(f"CSV read successfully with default settings")
                except Exception as e1:
                    app.logger.warning(f"Default CSV read failed: {e1}")
                    try:
                        # Try with different encoding
                        df = pd.read_csv(filepath, encoding='utf-8')
                        app.logger.info(f"CSV read successfully with UTF-8 encoding")
                    except Exception as e2:
                        app.logger.warning(f"UTF-8 CSV read failed: {e2}")
                        try:
                            # Try with latin-1 encoding
                            df = pd.read_csv(filepath, encoding='latin-1')
                            app.logger.info(f"CSV read successfully with latin-1 encoding")
                        except Exception as e3:
                            app.logger.warning(f"latin-1 CSV read failed: {e3}")
                            # Try with semicolon separator
                            df = pd.read_csv(filepath, sep=';')
                            app.logger.info(f"CSV read successfully with semicolon separator")
                
                # Clean column names - remove quotes and whitespace
                original_columns = list(df.columns)
                df.columns = df.columns.str.strip().str.replace('"', '').str.replace("'", "")
                
                app.logger.info(f"Original columns: {original_columns}")
                app.logger.info(f"Cleaned columns: {list(df.columns)}")
                app.logger.info(f"DataFrame shape: {df.shape}")
                app.logger.info(f"First few rows:\n{df.head()}")
                
                # Check if we have the expected columns
                expected_columns = ['Time of Day', 'Process Name', 'PID', 'Operation', 'Path', 'Result', 'Detail', 'TID']
                found_columns = []
                
                for expected in expected_columns:
                    for actual in df.columns:
                        if expected.lower().replace(' ', '') in actual.lower().replace(' ', ''):
                            found_columns.append(actual)
                            break
                
                app.logger.info(f"Found expected columns: {found_columns}")
                
                # Fill NaN values
                df = df.fillna('')
                
                # Convert to records
                data = df.to_dict('records')
                
                # Clean the data
                cleaned_data = []
                for record in data:
                    cleaned_record = {}
                    for key, value in record.items():
                        # Convert all values to strings to avoid JSON serialization issues
                        cleaned_record[key] = str(value) if pd.notna(value) else ''
                    cleaned_data.append(cleaned_record)
                
                session['csv_data'] = cleaned_data
                session['csv_filename'] = filename
                
                app.logger.info(f"Successfully processed {len(cleaned_data)} records")
                
                return jsonify({
                    'success': True,
                    'data': cleaned_data[:500],  # Limit for performance
                    'total_rows': len(cleaned_data),
                    'columns': list(df.columns),
                    'sample_data': cleaned_data[:3] if len(cleaned_data) > 0 else []
                })
                
            except Exception as parse_error:
                app.logger.error(f"CSV parsing error: {parse_error}")
                return jsonify({
                    'error': f'CSV parsing failed: {str(parse_error)}. Please check file format.'
                }), 400
        
        return jsonify({'error': 'Invalid file format. Please upload a .csv file.'}), 400
        
    except Exception as e:
        app.logger.error(f"Upload error: {e}")
        return jsonify({'error': f'Upload failed: {str(e)}'}), 500

@app.route('/analyze_ai', methods=['POST'])
def analyze_ai():
    try:
        data = request.get_json()
        api_key = data.get('api_key')
        analysis_type = data.get('analysis_type')
        selected_data = data.get('selected_data')
        
        if not api_key:
            return jsonify({'error': 'API key required'}), 400
        
        # Set OpenAI client
        client = openai.OpenAI(api_key=api_key)
        
        csv_data = session.get('csv_data', [])
        
        if analysis_type == 'all':
            prompt = generate_full_analysis_prompt(csv_data[:50])
        elif analysis_type == 'selected' and selected_data:
            prompt = generate_selected_analysis_prompt(selected_data)
        elif analysis_type == 'security':
            prompt = generate_security_assessment_prompt(csv_data)
        elif analysis_type == 'persistence':
            prompt = generate_persistence_check_prompt(csv_data)
        else:
            return jsonify({'error': 'Invalid analysis type'}), 400
        
        # Call OpenAI API
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {
                    "role": "system", 
                    "content": "You are a cybersecurity expert analyzing process monitoring data. Provide detailed, actionable security insights in a clear, structured format."
                },
                {
                    "role": "user", 
                    "content": prompt
                }
            ],
            max_tokens=1500,
            temperature=0.3
        )
        
        analysis_result = response.choices[0].message.content
        
        return jsonify({
            'success': True,
            'analysis': analysis_result
        })
        
    except Exception as e:
        app.logger.error(f"AI analysis error: {e}")
        return jsonify({'error': f'AI analysis failed: {str(e)}'}), 500

@app.route('/save_note', methods=['POST'])
def save_note():
    try:
        data = request.get_json()
        note_text = data.get('note')
        selected_node = data.get('selected_node')
        
        if 'notes' not in session:
            session['notes'] = []
        
        note = {
            'id': len(session['notes']) + 1,
            'text': note_text,
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'selected_node': selected_node
        }
        
        session['notes'].append(note)
        session.modified = True
        
        return jsonify({'success': True, 'note': note})
        
    except Exception as e:
        app.logger.error(f"Note save error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/get_notes', methods=['GET'])
def get_notes():
    return jsonify({'notes': session.get('notes', [])})

@app.route('/delete_note', methods=['POST'])
def delete_note():
    try:
        data = request.get_json()
        note_id = data.get('note_id')
        
        if 'notes' in session:
            session['notes'] = [note for note in session['notes'] if note['id'] != note_id]
            session.modified = True
        
        return jsonify({'success': True})
        
    except Exception as e:
        app.logger.error(f"Note delete error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/debug_csv', methods=['GET'])
def debug_csv():
    """Debug endpoint to check CSV data"""
    try:
        csv_data = session.get('csv_data', [])
        return jsonify({
            'total_records': len(csv_data),
            'sample_records': csv_data[:5],
            'columns': list(csv_data[0].keys()) if csv_data else [],
            'filename': session.get('csv_filename', 'No file uploaded')
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def generate_full_analysis_prompt(data):
    return f"""Analyze this process monitoring data for security threats:

Key areas to analyze:
1. Suspicious file access patterns
2. Potential malware behavior  
3. Registry modifications (especially startup/persistence)
4. Network-related activities
5. System file interactions
6. DLL hijacking attempts

Data sample: {json.dumps(data, indent=2)}

Provide detailed security analysis with specific threat indicators."""

def generate_selected_analysis_prompt(selected_data):
    return f"""Analyze this specific entity for security risks:

Entity Data: {json.dumps(selected_data, indent=2)}

Focus on:
- Behavioral patterns
- Security implications
- Risk assessment
- Recommended actions"""

def generate_security_assessment_prompt(data):
    total_ops = len(data)
    processes = len(set(row.get('Process Name', '') for row in data))
    failed_ops = len([row for row in data if row.get('Result', '') != 'SUCCESS'])
    system_access = len([row for row in data if 'System32' in str(row.get('Path', '')) or 'Windows' in str(row.get('Path', ''))])
    
    return f"""Comprehensive security assessment:

Statistics:
- Total Operations: {total_ops}
- Unique Processes: {processes}  
- Failed Operations: {failed_ops} ({round((failed_ops/total_ops)*100, 2) if total_ops > 0 else 0}%)
- System File Access: {system_access}

Sample Data: {json.dumps(data[:20], indent=2)}

Provide:
1. Overall security posture assessment
2. Critical vulnerabilities identified
3. Immediate action items
4. Long-term security recommendations"""

def generate_persistence_check_prompt(data):
    startup_ops = [row for row in data if any(keyword in str(row.get('Path', '')).lower() 
                  for keyword in ['startup', 'run', 'runonce', 'winlogon', 'shell folders'])]
    
    registry_ops = [row for row in data if any(keyword in str(row.get('Path', '')).lower()
                   for keyword in ['registry', 'hkey'])]
    
    dll_ops = [row for row in data if str(row.get('Path', '')).endswith('.dll') and 
              any(location in str(row.get('Path', '')) for location in ['Users', 'Temp'])]
    
    return f"""Persistence mechanism analysis:

Found indicators:
- Startup-related operations: {len(startup_ops)}
- Registry operations: {len(registry_ops)}  
- Suspicious DLL operations: {len(dll_ops)}

Startup Operations: {json.dumps(startup_ops[:5], indent=2)}
Registry Operations: {json.dumps(registry_ops[:5], indent=2)}
DLL Operations: {json.dumps(dll_ops[:5], indent=2)}

Analyze for:
1. Registry Run keys persistence
2. Startup folder modifications
3. Service installations
4. Scheduled tasks
5. DLL hijacking
6. Browser extension persistence

Provide detailed persistence threat assessment."""

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)