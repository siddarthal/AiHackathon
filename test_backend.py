#!/usr/bin/env python3
"""
Test script for the unified AI code assistant backend.
Run this after starting the backend to verify all endpoints work.
"""

import requests
import json
import sys

BASE_URL = "http://localhost:8000"

def test_endpoint(name, method, endpoint, payload=None, expected_status=200):
    """Test a single endpoint."""
    url = f"{BASE_URL}{endpoint}"
    print(f"\n{'='*60}")
    print(f"Testing: {name}")
    print(f"URL: {url}")
    
    try:
        if method == "GET":
            response = requests.get(url, timeout=10)
        elif method == "POST":
            response = requests.post(url, json=payload, timeout=30)
        else:
            print(f"❌ Unknown method: {method}")
            return False
        
        print(f"Status: {response.status_code}")
        
        if response.status_code == expected_status:
            print("✅ Success")
            try:
                data = response.json()
                print(f"Response: {json.dumps(data, indent=2)[:500]}")
            except:
                print(f"Response: {response.text[:200]}")
            return True
        else:
            print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
            print(f"Response: {response.text[:500]}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection failed - Is the backend running?")
        return False
    except requests.exceptions.Timeout:
        print("⚠️  Request timed out")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def main():
    print("="*60)
    print("Backend API Test Suite")
    print("="*60)
    
    results = []
    
    # Test 1: Root endpoint
    results.append(test_endpoint(
        "Root Endpoint",
        "GET",
        "/"
    ))
    
    # Test 2: Health check
    results.append(test_endpoint(
        "Health Check",
        "GET",
        "/health"
    ))
    
    # Test 3: Config endpoint
    results.append(test_endpoint(
        "Configuration",
        "GET",
        "/config"
    ))
    
    # Test 4: Chat endpoint (simple)
    results.append(test_endpoint(
        "Chat Endpoint",
        "POST",
        "/chat",
        {
            "messages": [
                {"role": "user", "content": "What is 2+2?"}
            ],
            "max_tokens": 50
        }
    ))
    
    # Test 5: Completion endpoint
    results.append(test_endpoint(
        "Completion Endpoint",
        "POST",
        "/complete",
        {
            "prefix": "def hello():",
            "max_tokens": 30
        }
    ))
    
    # Print summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    passed = sum(results)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    
    if passed == total:
        print("✅ All tests passed!")
        return 0
    else:
        print(f"⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())

