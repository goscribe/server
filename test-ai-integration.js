// Test script for AI backend integration
// Run this with: node test-ai-integration.js

const AI_SERVICE_URL = 'https://txp-tckxn64wn5vtgip72-kzoemq8qw-custom.service.onethingrobot.com/upload';
const AI_RESPONSE_URL = 'https://txp-tckxn64wn5vtgip72-kzoemq8qw-custom.service.onethingrobot.com/last_response';

async function testAIBackend() {
  console.log('🧪 Testing AI Backend Integration...\n');

  try {
    // Test 1: Initialize Session
    console.log('1️⃣ Testing Session Initialization...');
    const sessionId = `test_session_${Date.now()}`;
    const formData1 = new FormData();
    formData1.append('command', 'init_session');
    formData1.append('id', sessionId);

    const response1 = await fetch(AI_SERVICE_URL, {
      method: 'POST',
      body: formData1,
    });

    if (response1.ok) {
      const result1 = await response1.json();
      console.log('✅ Session initialized:', result1);
    } else {
      console.log('❌ Session init failed:', response1.status, response1.statusText);
      return;
    }

    // Test 2: Set Instruction
    console.log('\n2️⃣ Testing Instruction Setting...');
    const formData2 = new FormData();
    formData2.append('command', 'set_instruct');
    formData2.append('instruction_text', 'Create flashcards about calculus derivatives');

    const response2 = await fetch(AI_SERVICE_URL, {
      method: 'POST',
      body: formData2,
    });

    if (response2.ok) {
      const result2 = await response2.json();
      console.log('✅ Instruction set:', result2);
    } else {
      console.log('❌ Instruction setting failed:', response2.status, response2.statusText);
    }

    // Test 3: Start LLM Session
    console.log('\n3️⃣ Testing LLM Session Start...');
    const formData3 = new FormData();
    formData3.append('command', 'start_LLM_session');

    const response3 = await fetch(AI_SERVICE_URL, {
      method: 'POST',
      body: formData3,
    });

    if (response3.ok) {
      const result3 = await response3.json();
      console.log('✅ LLM session started:', result3);
    } else {
      console.log('❌ LLM session start failed:', response3.status, response3.statusText);
    }

    // Test 4: Generate Study Guide
    console.log('\n4️⃣ Testing Study Guide Generation...');
    const formData4 = new FormData();
    formData4.append('command', 'generate_study_guide');

    const response4 = await fetch(AI_SERVICE_URL, {
      method: 'POST',
      body: formData4,
    });

    if (response4.ok) {
      console.log('✅ Study guide generation started');
      
      // Wait a bit for generation to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get the generated content
      const contentResponse = await fetch(AI_RESPONSE_URL);
      if (contentResponse.ok) {
        const content = await contentResponse.text();
        console.log('📚 Generated Study Guide Preview:');
        console.log(content.substring(0, 200) + '...');
      } else {
        console.log('❌ Failed to retrieve generated content');
      }
    } else {
      console.log('❌ Study guide generation failed:', response4.status, response4.statusText);
    }

    // Test 5: Generate Flashcard Questions
    console.log('\n5️⃣ Testing Flashcard Generation...');
    const formData5 = new FormData();
    formData5.append('command', 'generate_flashcard_questions');
    formData5.append('num_questions', '3');
    formData5.append('difficulty', 'medium');

    const response5 = await fetch(AI_SERVICE_URL, {
      method: 'POST',
      body: formData5,
    });

    if (response5.ok) {
      console.log('✅ Flashcard generation started');
      
      // Wait a bit for generation to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get the generated content
      const contentResponse = await fetch(AI_RESPONSE_URL);
      if (contentResponse.ok) {
        const content = await contentResponse.text();
        console.log('🃏 Generated Flashcards Preview:');
        console.log(content.substring(0, 200) + '...');
      } else {
        console.log('❌ Failed to retrieve generated content');
      }
    } else {
      console.log('❌ Flashcard generation failed:', response5.status, response5.statusText);
    }

    console.log('\n🎉 AI Backend Integration Test Complete!');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testAIBackend();
